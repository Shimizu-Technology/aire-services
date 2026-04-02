# frozen_string_literal: true

FactoryBot.define do
  factory :employee_pay_rate do
    association :user
    association :time_category
    hourly_rate_cents { 3500 }
  end
end
