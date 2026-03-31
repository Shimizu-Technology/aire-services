# frozen_string_literal: true

class TimeEntry < ApplicationRecord
  ENTRY_METHODS = %w[clock manual].freeze
  CLOCK_SOURCES = %w[kiosk mobile admin legacy].freeze
  STATUSES = %w[clocked_in on_break completed].freeze
  ATTENDANCE_STATUSES = %w[early on_time late].freeze
  APPROVAL_STATUSES = %w[pending approved denied].freeze
  OVERTIME_STATUSES = %w[none pending approved denied].freeze

  belongs_to :user, optional: true
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
  validate :end_time_after_start_time

  before_validation :calculate_hours_from_times, if: -> { start_time.present? && end_time.present? }
  before_validation :set_zero_hours_if_clocked_in, if: -> { status.in?(%w[clocked_in on_break]) }

  scope :for_date, ->(date) { where(work_date: date) }
  scope :for_week, ->(date) { where(work_date: date.beginning_of_week(:sunday)..date.end_of_week(:sunday)) }
  scope :for_user, ->(user) { where(user: user) }
  scope :recent, -> { order(work_date: :desc, created_at: :desc) }
  scope :clocked_in, -> { where(status: %w[clocked_in on_break]) }
  scope :pending_approval, -> { where(approval_status: "pending") }
  scope :approved, -> { where(approval_status: ["approved", nil]) }
  scope :denied, -> { where(approval_status: "denied") }
  scope :clock_entries, -> { where(entry_method: "clock") }
  scope :manual_entries, -> { where(entry_method: "manual") }
  # Clock entries have nil approval_status (they don't go through the approval
  # flow), so nil is intentionally treated as countable alongside "approved".
  scope :countable, -> { where("approval_status IS NULL OR approval_status NOT IN (?)", %w[denied pending]).where(status: "completed") }

  def locked?
    locked_at.present?
  end

  def editable_by?(acting_user)
    return false if locked?
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
    status == "completed" && !approval_status.in?(%w[denied pending])
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

  def calculate_hours_from_times
    return unless start_time.present? && end_time.present?

    start_seconds = start_time.utc.seconds_since_midnight
    end_seconds = end_time.utc.seconds_since_midnight

    if end_seconds < start_seconds
      end_seconds += 24 * 3600
    end

    duration_hours = (end_seconds - start_seconds) / 3600.0

    if break_minutes.present? && break_minutes > 0
      duration_hours -= (break_minutes / 60.0)
    end

    self.hours = [duration_hours, 0].max.round(2)
  end

  def formatted_start_time
    start_time&.in_time_zone(TimeClockService::BUSINESS_TIMEZONE)&.strftime("%I:%M %p")&.sub(/^0/, "")
  end

  def formatted_end_time
    end_time&.in_time_zone(TimeClockService::BUSINESS_TIMEZONE)&.strftime("%I:%M %p")&.sub(/^0/, "")
  end

  private

  def set_zero_hours_if_clocked_in
    self.hours = 0 if hours.blank?
  end

  def end_time_after_start_time
    return unless start_time.present? && end_time.present?

    tz = ActiveSupport::TimeZone[TimeClockService::BUSINESS_TIMEZONE]
    start_local = start_time.in_time_zone(tz).seconds_since_midnight
    end_local = end_time.in_time_zone(tz).seconds_since_midnight

    if end_local <= start_local
      errors.add(:end_time, "must be after start time")
    end
  end

  def completed_manual_entry_has_positive_hours
    return unless manual_entry? && status == "completed"
    return unless hours.present? && hours <= 0

    errors.add(:hours, "must be greater than 0 for completed entries")
  end
end
