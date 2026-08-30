# frozen_string_literal: true

FactoryBot.define do
  factory :user do
    sequence(:email) { |n| "user#{n}@example.com" }
    sequence(:clerk_id) { |n| "clerk_#{n}" }
    first_name { "Test" }
    last_name { "User" }
    role { "employee" }
    personal_access_enabled { true }
    profile_source { "clerk" }
    time_tracking_enabled { false }

    trait :admin do
      role { "admin" }
      first_name { "Admin" }
    end

    trait :employee do
      role { "employee" }
    end

    trait :kiosk_only do
      email { nil }
      personal_access_enabled { false }
      profile_source { "local" }
      time_tracking_enabled { true }
      kiosk_enabled { true }
      sequence(:kiosk_pin) { |n| format("%06d", n % 1_000_000) }
    end
  end
end
