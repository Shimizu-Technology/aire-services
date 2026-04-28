# frozen_string_literal: true

FactoryBot.define do
  factory :leave_request do
    association :user
    leave_type { "paid_time_off" }
    start_date { Date.current + 7.days }
    end_date { start_date + 1.day }
    status { "pending" }
    reason { "Family event" }
  end
end
