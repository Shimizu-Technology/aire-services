# frozen_string_literal: true

FactoryBot.define do
  factory :time_entry do
    association :user
    work_date { Date.current }
    start_time { Time.zone.parse("09:00") }
    end_time { Time.zone.parse("17:00") }
    hours { 8.0 }
    description { "Test work" }

    trait :locked do
      locked_at { Time.current }
    end
  end
end
