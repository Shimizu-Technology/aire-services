# frozen_string_literal: true

class PayrollCutoffAcknowledgement < ApplicationRecord
  belongs_to :user
  belongs_to :payroll_calendar_period
  validates :stage, inclusion: { in: %w[24h 4h] }

  def self.identity(user, cutoff)
    { user_id: user.id, payroll_calendar_period_id: cutoff.dig(:period, :id),
      publication_id: cutoff[:publication_id], publication_version: cutoff[:version], stage: cutoff[:stage] }
  end
end
