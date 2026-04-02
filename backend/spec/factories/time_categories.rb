# frozen_string_literal: true

FactoryBot.define do
  factory :time_category do
    sequence(:name) { |n| "Category #{n}" }
    sequence(:key) { |n| "aire_category_#{n}" }
    description { "AIRE work category" }
    hourly_rate_cents { 2500 }
    is_active { true }
  end
end
