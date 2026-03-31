# frozen_string_literal: true

FactoryBot.define do
  factory :time_period_lock do
    start_date { Date.current.beginning_of_week(:sunday) }
    end_date { start_date + 6.days }
    locked_at { Time.current }
    locked_by { create(:user, :admin) }
    reason { "Payroll finalized" }
  end
end
