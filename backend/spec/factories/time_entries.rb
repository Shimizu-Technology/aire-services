# frozen_string_literal: true

FactoryBot.define do
  factory :time_entry do
    association :user
    work_date { Date.current }
    start_time { ActiveSupport::TimeZone["Pacific/Guam"].local(2000, 1, 1, 9, 0, 0) }
    end_time { ActiveSupport::TimeZone["Pacific/Guam"].local(2000, 1, 1, 17, 0, 0) }
    hours { 8.0 }
    description { "Test work" }

    trait :locked do
      locked_at { Time.current }
    end
  end
end
