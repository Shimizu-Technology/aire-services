# frozen_string_literal: true

FactoryBot.define do
  factory :payroll_batch do
    sequence(:public_id) { |number| "AIRE-PAY-CASE-#{number}" }
    start_date { Date.new(2026, 9, 1) }
    end_date { Date.new(2026, 9, 15) }
    cutoff_at { ActiveSupport::TimeZone["Pacific/Guam"].local(2026, 9, 18, 17) }
    finalized_at { cutoff_at }
    checksum { "a" * 64 }
  end

  factory :payroll_settlement_case do
    association :origin_payroll_batch, factory: :payroll_batch
    sequence(:source_time_entry_id) { |number| number }
    sequence(:source_user_id) { |number| number }
    source_user_uuid { SecureRandom.uuid }
    origin_reason { "pending_approval" }
    original_work_date { origin_payroll_batch.start_date }
    held_total_hours { 8 }
    action_due_on { origin_payroll_batch.end_date + 10.days }
    source_snapshot { {} }
  end
end
