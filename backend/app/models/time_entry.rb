# frozen_string_literal: true

class TimeEntry < ApplicationRecord
  attr_accessor :payroll_break_chronology, :skip_overtime_recomputation
  around_save :recompute_affected_overtime
  around_destroy :recompute_destroyed_overtime, prepend: true

  # Services which already require a row lock must acquire the employee lock
  # first, just like direct saves, so concurrent approvals cannot deadlock.
  def lock!(lock = true)
    self.class.transaction do
      Payroll::AffectedOvertimeReview.lock([ user_id, attribute_in_database("user_id") ]) { super(lock) }
    end
  end

  MAX_CLOCK_SPAN = 24.hours
  ADMINISTRATOR_CORRECTION_NOTE = "Needs administrator correction: clock spans 24 hours or more; confirm punches and breaks before approval".freeze

  ENTRY_METHODS = %w[clock manual].freeze
  CLOCK_SOURCES = %w[kiosk mobile admin legacy].freeze
  STATUSES = %w[clocked_in on_break completed].freeze
  ATTENDANCE_STATUSES = %w[early on_time late].freeze
  APPROVAL_STATUSES = %w[pending approved denied].freeze
  OVERTIME_STATUSES = %w[none pending approved denied].freeze

  belongs_to :user
  belongs_to :time_category, optional: true
  belongs_to :schedule, optional: true
  belongs_to :approved_by, class_name: "User", optional: true
  belongs_to :overtime_approved_by, class_name: "User", optional: true
  has_many :time_entry_breaks, dependent: :destroy

  validates :work_date, presence: true
  validates :hours, presence: true, numericality: { greater_than_or_equal_to: 0, less_than_or_equal_to: 24 }
  validate :completed_manual_entry_has_positive_hours
  validates :entry_method, presence: true, inclusion: { in: ENTRY_METHODS }
  validates :clock_source, inclusion: { in: CLOCK_SOURCES }, allow_nil: true
  validates :status, presence: true, inclusion: { in: STATUSES }
  validates :attendance_status, inclusion: { in: ATTENDANCE_STATUSES }, allow_nil: true
  validates :approval_status, inclusion: { in: APPROVAL_STATUSES }, allow_nil: true
  validates :overtime_status, inclusion: { in: OVERTIME_STATUSES }, allow_nil: true
  validates :start_time, presence: true, if: -> { status == "completed" }
  validates :end_time, presence: true, if: -> { status == "completed" }
  validates :time_category, presence: { message: "must be selected" }, if: -> { status == "completed" }
  validate :end_time_after_start_time
  validate :selected_time_category_is_active, if: :validate_selected_time_category?

  before_validation :capture_allocation_contract
  before_validation :calculate_hours_from_times, if: :time_calculation_required?
  validate :held_clock_cannot_be_approved
  before_validation :set_zero_hours_if_clocked_in, if: -> { status.in?(%w[clocked_in on_break]) }
  after_commit :capture_post_cutoff_payroll_case, on: [ :create, :update ], if: :payroll_case_relevant_change?
  after_update :invalidate_unassigned_payroll_selection

  scope :for_date, ->(date) { where(work_date: date) }
  scope :for_week, ->(date) { where(work_date: date.beginning_of_week(:sunday)..date.end_of_week(:sunday)) }
  scope :for_user, ->(user) { where(user: user) }
  scope :recent, -> { order(work_date: :desc, created_at: :desc) }
  scope :clocked_in, -> { where(status: %w[clocked_in on_break]) }
  scope :pending_approval, -> { where(approval_status: "pending") }
  scope :approved, -> { where(approval_status: [ "approved", nil ]) }
  scope :denied, -> { where(approval_status: "denied") }
  scope :clock_entries, -> { where(entry_method: "clock") }
  scope :manual_entries, -> { where(entry_method: "manual") }
  scope :for_payroll_period, lambda { |period|
    joins(:user)
      .merge(User.staff)
      .where(work_date: period.start_date..period.end_date)
  }
  # Clock-created entries count unless explicitly held or denied. Manual entries
  # require an explicit approval, including legacy rows whose status is nil.
  scope :countable, lambda {
    where(status: "completed").where(
      "(entry_method = :clock AND (approval_status IS NULL OR approval_status = :approved)) OR " \
      "(entry_method = :manual AND approval_status = :approved)",
      clock: "clock",
      manual: "manual",
      approved: "approved"
    )
  }

  def editable_by?(acting_user)
    acting_user.admin? || user_id == acting_user.id
  end

  def deletable_by?(acting_user)
    editable_by?(acting_user)
  end

  def clock_entry?
    entry_method == "clock"
  end

  def manual_entry?
    entry_method == "manual"
  end

  def active?
    status.in?(%w[clocked_in on_break])
  end

  def pending_approval?
    approval_status == "pending"
  end

  def counts_toward_hours?
    status == "completed" && (clock_entry? ? !approval_status.in?(%w[denied pending]) : approval_status == "approved")
  end

  def active_payroll_exports
    ReportExport.active_for_entry(id)
  end

  def finalized_payroll_batches
    entry_batch_ids = PayrollBatchEntry.where(source_time_entry_id: id).select(:payroll_batch_id)
    exclusion_batch_ids = PayrollBatchExclusion.where(source_time_entry_id: id).select(:payroll_batch_id)

    PayrollBatch.where(id: entry_batch_ids)
      .or(PayrollBatch.where(id: exclusion_batch_ids))
      .where.not(finalized_at: nil)
      .distinct
  end

  def total_break_minutes
    if time_entry_breaks.loaded?
      time_entry_breaks.select { |b| b.duration_minutes.present? }.sum(&:duration_minutes)
    else
      time_entry_breaks.where.not(duration_minutes: nil).sum(:duration_minutes)
    end
  end

  def active_break
    if time_entry_breaks.loaded?
      time_entry_breaks.find { |b| b.end_time.nil? }
    else
      time_entry_breaks.where(end_time: nil).first
    end
  end

  def net_hours
    return 0 unless hours.present?
    hours.round(2)
  end

  def actual_elapsed_hours
    return unless clock_entry? && clock_in_at && clock_out_at

    (clock_out_at - clock_in_at) / 3600.0
  end

  def needs_administrator_correction?
    actual_elapsed_hours.to_f >= MAX_CLOCK_SPAN / 3600.0
  end

  def calculate_hours_from_times
    # Some correction services call this explicitly for note-only edits. Do not
    # reinterpret historical approved punches unless calculation inputs changed.
    return unless time_calculation_required?

    if needs_administrator_correction?
      self.hours = 0
      self.approval_status = "pending"
      self.approved_by = nil
      self.approved_at = nil
      self.approval_note = [ approval_note.presence, ADMINISTRATOR_CORRECTION_NOTE ].compact.uniq.join(" | ") unless approval_note.to_s.include?(ADMINISTRATOR_CORRECTION_NOTE)
      return
    end

    start_seconds = start_time.utc.seconds_since_midnight
    end_seconds = end_time.utc.seconds_since_midnight

    if end_seconds < start_seconds
      end_seconds += 24 * 3600
    end

    duration_hours = (end_seconds - start_seconds) / 3600.0
    # Actual timestamps retain the date and precision absent from nominal TIME
    # columns. Corrected nominal endpoints deliberately remain authoritative.
    if clock_entry? && clock_in_at && clock_out_at &&
       start_seconds == clock_in_at.utc.seconds_since_midnight &&
       end_time.utc.seconds_since_midnight == clock_out_at.utc.seconds_since_midnight
      duration_hours = actual_elapsed_hours
    end

    if break_minutes.present? && break_minutes > 0
      duration_hours -= (break_minutes / 60.0)
    end

    self.hours = [ duration_hours, 0 ].max.round(2)
  end

  def formatted_start_time
    start_time&.in_time_zone(TimeClockService::BUSINESS_TIMEZONE)&.strftime("%I:%M %p")&.sub(/^0/, "")
  end

  def formatted_end_time
    end_time&.in_time_zone(TimeClockService::BUSINESS_TIMEZONE)&.strftime("%I:%M %p")&.sub(/^0/, "")
  end

  private

  def capture_allocation_contract
    if new_record? || (changes.keys & Payroll::AffectedOvertimeReview::INPUTS).any?
      self.allocation_contract_version = Payroll::WeeklyOvertimeAllocator::CONTRACT_VERSION
    end
  end

  def recompute_affected_overtime(&block)
    Payroll::AffectedOvertimeReview.around(self, &block)
  end

  def recompute_destroyed_overtime(&block)
    Payroll::AffectedOvertimeReview.around(self, force: true, &block)
  end

  def time_calculation_required?
    start_time.present? && end_time.present? &&
      (new_record? || (changes.keys & %w[start_time end_time clock_in_at clock_out_at break_minutes status hours]).any?)
  end

  def held_clock_cannot_be_approved
    if will_save_change_to_approval_status?(to: "approved") && needs_administrator_correction?
      errors.add(:approval_status, "needs administrator correction before approval")
    end
  end

  PAYROLL_CASE_ATTRIBUTES = %w[
    user_id work_date start_time end_time hours break_minutes time_category_id status
    approval_status approved_at overtime_status overtime_approved_at
  ].freeze

  def payroll_case_relevant_change?
    (previous_changes.keys & PAYROLL_CASE_ATTRIBUTES).any?
  end

  def capture_post_cutoff_payroll_case
    previous_work_date = previous_changes.dig("work_date", 0)
    PayrollSettlementCaseCaptureJob.perform_later(id, previous_work_date&.to_s, Current.user&.id)
  end

  def set_zero_hours_if_clocked_in
    self.hours = 0 if hours.blank?
  end

  def validate_selected_time_category?
    time_category_id.present? && (new_record? || will_save_change_to_time_category_id?)
  end

  def selected_time_category_is_active
    errors.add(:time_category, "must be active") unless time_category&.is_active?
  end

  def end_time_after_start_time
    return unless start_time.present? && end_time.present?

    if clock_entry? && clock_in_at.present? && clock_out_at.present?
      if clock_out_at <= clock_in_at
        errors.add(:end_time, "must be after start time")
      end
      return
    end

    start_local = start_time.in_time_zone(TimeClockService::BUSINESS_TIMEZONE).seconds_since_midnight
    end_local = end_time.in_time_zone(TimeClockService::BUSINESS_TIMEZONE).seconds_since_midnight

    if end_local <= start_local
      errors.add(:end_time, "must be after start time")
    end
  end

  # Case versions presented by late-hours discovery must also become stale
  # after a source edit/approval. Keep the immutable origin version unchanged.
  def invalidate_unassigned_payroll_selection
    PayrollSettlementCase.where(source_time_entry_id: id, status: "open", destination_kind: "unassigned")
      .update_all("lock_version = lock_version + 1")
  end

  def completed_manual_entry_has_positive_hours
    return unless manual_entry? && status == "completed"
    return unless hours.present? && hours <= 0

    errors.add(:hours, "must be greater than 0 for completed entries")
  end
end
