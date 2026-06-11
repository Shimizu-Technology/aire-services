# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Api::V1::SiteMedia", type: :request do
  def json
    JSON.parse(response.body, symbolize_names: true)
  end

  describe "GET /api/v1/site-media" do
    let(:photo_path) { Rails.root.join("spec/fixtures/files/team_photo.png") }

    it "returns active media grouped by placement" do
      create(:site_media, title: "Home", placement: "home_hero", active: true)
      create(:site_media, title: "Hidden", placement: "home_hero", active: false)
      create(:site_media, :video, title: "Video", placement: "programs_video", active: true)

      get "/api/v1/site-media", params: { placements: "home_hero,programs_video" }

      expect(response).to have_http_status(:ok)
      expect(json[:site_media].map { |item| item[:title] }).to contain_exactly("Home", "Video")
      expect(json.dig(:by_placement, :home_hero).first[:title]).to eq("Home")
    end

    it "returns optimized image variants for uploaded public media" do
      media = build(:site_media, title: "Uploaded hero", external_url: nil)
      media.file.attach(
        io: File.open(photo_path),
        filename: "team_photo.png",
        content_type: "image/png"
      )
      media.save!

      get "/api/v1/site-media", params: { placements: "home_hero" }

      expect(response).to have_http_status(:ok)
      item = json[:site_media].first
      expect(item[:file_url]).to include("/rails/active_storage/blobs")
      expect(item[:file_thumb_url]).to include("/rails/active_storage/representations")
      expect(item[:file_card_url]).to include("/rails/active_storage/representations")
      expect(item[:file_hero_url]).to include("/rails/active_storage/representations")
    end
  end
end
