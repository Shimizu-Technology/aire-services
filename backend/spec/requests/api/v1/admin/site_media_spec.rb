# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Api::V1::Admin::SiteMedia", type: :request do
  let(:admin) { create(:user, :admin) }
  let(:employee) { create(:user, :employee) }

  let(:auth_headers_for) do
    ->(user) { { "Authorization" => "Bearer test_token_#{user.id}" } }
  end

  def json
    JSON.parse(response.body, symbolize_names: true)
  end

  describe "GET /api/v1/admin/site-media" do
    it "lists media for admins" do
      create(:site_media, title: "Hero")

      get "/api/v1/admin/site-media", headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      expect(json[:site_media].first[:title]).to eq("Hero")
    end

    it "blocks non-admins" do
      get "/api/v1/admin/site-media", headers: auth_headers_for[employee]

      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "POST /api/v1/admin/site-media" do
    it "creates linked video media" do
      post "/api/v1/admin/site-media",
           params: {
             title: "Island tour reel",
             placement: "programs_video",
             media_type: "video",
             external_url: "https://www.youtube.com/watch?v=abc123",
             active: true
           },
           headers: auth_headers_for[admin]

      expect(response).to have_http_status(:created)
      expect(json.dig(:site_media, :media_type)).to eq("video")
      expect(json.dig(:site_media, :external_url)).to include("youtube.com")
    end

    it "requires alt text for images" do
      post "/api/v1/admin/site-media",
           params: {
             title: "No alt",
             placement: "home_hero",
             media_type: "image",
             external_url: "https://example.com/image.jpg"
           },
           headers: auth_headers_for[admin]

      expect(response).to have_http_status(:unprocessable_entity)
      expect(json[:error]).to match(/Alt text/)
    end
  end
end
