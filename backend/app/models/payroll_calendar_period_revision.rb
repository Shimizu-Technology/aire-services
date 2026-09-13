# frozen_string_literal: true

class PayrollCalendarPeriodRevision < ApplicationRecord
  belongs_to :payroll_calendar_period

  validates :schedule_version, :publication_id, :request_checksum, :published_at, presence: true
  validates :schedule_version, numericality: { only_integer: true, greater_than: 0 },
                               uniqueness: { scope: :payroll_calendar_period_id }
  validates :publication_id, uniqueness: true
  validates :request_checksum, format: { with: /\A[0-9a-f]{64}\z/ }

  def readonly?
    persisted?
  end
end
