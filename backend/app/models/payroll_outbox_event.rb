# frozen_string_literal: true

class PayrollOutboxEvent < ApplicationRecord
  DELIVERY_STATUSES = %w[pending failed delivered].freeze

  belongs_to :payroll_calendar_period

  before_validation :assign_event_id, on: :create

  validates :event_id, :event_type, :occurred_at, presence: true
  validates :event_id, uniqueness: true
  validates :event_type, inclusion: { in: [ "payroll_batch.finalized" ] }
  validates :delivery_status, inclusion: { in: DELIVERY_STATUSES }
  validates :delivery_attempts, numericality: { only_integer: true, greater_than_or_equal_to: 0 }

  scope :due_at, lambda { |time|
    where(delivery_status: %w[pending failed])
      .where("next_delivery_attempt_at IS NULL OR next_delivery_attempt_at <= ?", time)
  }

  private

  def assign_event_id
    self.event_id ||= SecureRandom.uuid
  end
end
