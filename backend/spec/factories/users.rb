# frozen_string_literal: true

FactoryBot.define do
  factory :user do
    sequence(:email) { |n| "user#{n}@example.com" }
    sequence(:clerk_id) { |n| "clerk_#{n}" }
    first_name { "Test" }
    last_name { "User" }
    role { "employee" }

    trait :admin do
      role { "admin" }
      first_name { "Admin" }
    end

    trait :employee do
      role { "employee" }
    end
  end
end
