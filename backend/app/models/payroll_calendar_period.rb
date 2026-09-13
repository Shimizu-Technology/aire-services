# frozen_string_literal: true

class PayrollCalendarPeriod < ApplicationRecord
  BUSINESS_TIME_ZONE = "Pacific/Guam"
  CUTOFF_DAYS_BEFORE = 7
  STATUSES = %w[scheduled failed finalized].freeze

  belongs_to :payroll_batch, optional: true
  has_many :payroll_calendar_period_revisions, dependent: :restrict_with_error
  has_many :payroll_outbox_events, dependent: :restrict_with_error

  validates :external_pay_period_id, :start_date, :end_date, :pay_date, :cutoff_at,
            :publication_id, :request_checksum, presence: true
  validates :external_pay_period_id, uniqueness: true
  validates :publication_id,
            format: { with: /\A[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/i }
  validates :request_checksum, format: { with: /\A[0-9a-f]{64}\z/ }
  validates :time_zone, inclusion: { in: [ BUSINESS_TIME_ZONE ] }
  validates :cutoff_days_before, numericality: { equal_to: CUTOFF_DAYS_BEFORE }
  validates :schedule_version, numericality: { only_integer: true, greater_than: 0 }
  validates :status, inclusion: { in: STATUSES }
  validates :finalization_attempts, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validate :semimonthly_period
  validate :pay_date_after_period
  validate :cutoff_matches_policy
  validate :finalized_state_is_complete

  scope :due_at, lambda { |time|
    where(status: %w[scheduled failed])
      .where(cutoff_at: ..time)
      .where("next_finalization_attempt_at IS NULL OR next_finalization_attempt_at <= ?", time)
  }

  def cutoff_state(now: Time.current)
    return "finalized" if status == "finalized"
    return "attention_required" if status == "failed"
    return "due" if cutoff_at <= now

    "upcoming"
  end

  def as_contract_json(now: Time.current)
    {
      external_pay_period_id: external_pay_period_id,
      start_date: start_date.iso8601,
      end_date: end_date.iso8601,
      pay_date: pay_date.iso8601,
      cutoff_at: cutoff_at.in_time_zone(time_zone).iso8601,
      time_zone: time_zone,
      cutoff_days_before: cutoff_days_before,
      version: lock_version,
      schedule_version: schedule_version,
      publication_id: publication_id,
      status: status,
      cutoff_state: cutoff_state(now: now),
      payroll_batch_id: payroll_batch&.public_id,
      finalized_at: finalized_at&.in_time_zone(time_zone)&.iso8601,
      finalization_attempts: finalization_attempts,
      last_finalization_attempt_at: last_finalization_attempt_at&.in_time_zone(time_zone)&.iso8601,
      next_finalization_attempt_at: next_finalization_attempt_at&.in_time_zone(time_zone)&.iso8601,
      last_finalization_error: last_finalization_error
    }.compact
  end

  private

  def semimonthly_period
    return if start_date.blank? || end_date.blank?

    first_half = start_date.day == 1 && end_date == Date.new(start_date.year, start_date.month, 15)
    second_half = start_date.day == 16 && end_date == start_date.end_of_month
    errors.add(:base, "period must be the 1st–15th or 16th–month end") unless first_half || second_half
  end

  def pay_date_after_period
    return if pay_date.blank? || end_date.blank? || pay_date > end_date

    errors.add(:pay_date, "must be after the period end")
  end

  def cutoff_matches_policy
    return if cutoff_at.blank? || pay_date.blank? || time_zone.blank?
    return unless time_zone == BUSINESS_TIME_ZONE
    return unless cutoff_days_before == CUTOFF_DAYS_BEFORE

    local_cutoff_date = cutoff_at.in_time_zone(time_zone).to_date
    return if local_cutoff_date == pay_date - cutoff_days_before

    errors.add(:cutoff_at, "must fall seven calendar days before the pay date in Pacific/Guam")
  end

  def finalized_state_is_complete
    return unless status == "finalized"
    return if payroll_batch_id.present? && finalized_at.present?

    errors.add(:base, "finalized periods require a payroll batch and finalized timestamp")
  end
end
