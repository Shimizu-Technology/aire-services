# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Api::V1::SiteMedia", type: :request do
  def json
    JSON.parse(response.body, symbolize_names: true)
  end

  describe "GET /api/v1/site-media" do
    it "returns active media grouped by placement" do
      create(:site_media, title: "Home", placement: "home_hero", active: true)
      create(:site_media, title: "Hidden", placement: "home_hero", active: false)
      create(:site_media, :video, title: "Video", placement: "programs_video", active: true)

      get "/api/v1/site-media", params: { placements: "home_hero,programs_video" }

      expect(response).to have_http_status(:ok)
      expect(json[:site_media].map { |item| item[:title] }).to contain_exactly("Home", "Video")
      expect(json.dig(:by_placement, :home_hero).first[:title]).to eq("Home")
    end
  end
end
