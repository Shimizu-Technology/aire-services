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

  def uploaded_jpeg(name = "image.jpg")
    file = Tempfile.new([ File.basename(name, ".jpg"), ".jpg" ])
    file.binmode
    file.write("\xFF\xD8\xFF\xE0\x00\x10JFIF\x00\x01\x01\x01\x00H\x00H\x00\x00\xFF\xD9")
    file.rewind
    Rack::Test::UploadedFile.new(file.path, "image/jpeg", original_filename: name)
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

  describe "PATCH /api/v1/admin/site-media/:id" do
    it "updates media details" do
      media = create(:site_media, title: "Old title")

      patch "/api/v1/admin/site-media/#{media.id}",
            params: {
              title: "New title",
              placement: "home_tours",
              media_type: "image",
              alt_text: "Aerial view of Tumon Bay",
              external_url: media.external_url,
              active: false
            },
            headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      expect(json.dig(:site_media, :title)).to eq("New title")
      expect(json.dig(:site_media, :placement)).to eq("home_tours")
      expect(json.dig(:site_media, :active)).to eq(false)
    end

    it "normalizes blank optional text fields to nil" do
      media = create(:site_media, media_type: "video", alt_text: nil, caption: "Old caption", external_url: "https://vimeo.com/123456789")

      patch "/api/v1/admin/site-media/#{media.id}",
            params: {
              title: "Video reel",
              placement: media.placement,
              media_type: "video",
              alt_text: " ",
              caption: "",
              external_url: " https://vimeo.com/987654321 "
            },
            headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      media.reload
      expect(media.alt_text).to be_nil
      expect(media.caption).to be_nil
      expect(media.external_url).to eq("https://vimeo.com/987654321")
    end

    it "does not purge the existing file when a replacement update fails validation" do
      media = create(:site_media)
      media.file.attach(io: StringIO.new("old image"), filename: "old.jpg", content_type: "image/jpeg")
      media.update_column(:external_url, nil)
      old_blob_id = media.file.blob.id

      allow_any_instance_of(ActiveStorage::Blob).to receive(:purge_later)

      patch "/api/v1/admin/site-media/#{media.id}",
            params: {
              title: "",
              placement: "home_hero",
              media_type: "image",
              alt_text: "Replacement image",
              file: uploaded_jpeg("replacement.jpg")
            },
            headers: auth_headers_for[admin]

      expect(response).to have_http_status(:unprocessable_entity)
      expect(media.reload.file.blob.id).to eq(old_blob_id)
      expect(ActiveStorage::Blob.find_by(id: old_blob_id)).to be_present
    end
  end

  describe "DELETE /api/v1/admin/site-media/:id" do
    it "destroys media records" do
      media = create(:site_media)

      delete "/api/v1/admin/site-media/#{media.id}", headers: auth_headers_for[admin]

      expect(response).to have_http_status(:no_content)
      expect(SiteMedia.exists?(media.id)).to eq(false)
    end
  end
end
