# frozen_string_literal: true

FactoryBot.define do
  factory :site_media do
    title { "Aerial hero" }
    alt_text { "AIRE aircraft flying over Guam" }
    placement { "home_hero" }
    media_type { "image" }
    external_url { "https://example.com/aire-hero.jpg" }
    active { true }
    sort_order { 0 }

    trait :video do
      title { "Tour reel" }
      alt_text { nil }
      placement { "programs_video" }
      media_type { "video" }
      external_url { "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }
    end
  end
end
