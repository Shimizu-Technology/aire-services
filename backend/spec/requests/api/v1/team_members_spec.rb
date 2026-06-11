# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Api::V1::TeamMembers", type: :request do
  def json
    JSON.parse(response.body, symbolize_names: true)
  end

  let(:photo_path) { Rails.root.join("spec/fixtures/files/team_photo.png") }
  let(:text_path) { Rails.root.join("spec/fixtures/files/not_image.txt") }

  describe "GET /api/v1/team_members" do
    it "returns active users configured for the public Team page in sort order" do
      hidden_user = create(:user, :employee, first_name: "Hidden", public_team_enabled: false)
      create(:user, :employee, first_name: "Inactive", is_active: false, public_team_enabled: true, public_team_title: "Flight Instructor")
      second_user = create(
        :user,
        :employee,
        first_name: "Second",
        public_team_enabled: true,
        public_team_title: "Chief Instructor",
        public_team_sort_order: 2
      )
      first_user = create(
        :user,
        :employee,
        first_name: "First",
        public_team_name: "Captain First",
        public_team_enabled: true,
        public_team_title: "Certified Flight Instructor",
        public_team_sort_order: 1
      )

      get "/api/v1/team_members"

      expect(response).to have_http_status(:ok)
      expect(json[:team_members]).to eq(
        [
          {
            id: first_user.id,
            name: "Captain First",
            title: "Certified Flight Instructor",
            photo_url: nil,
            photo_thumb_url: nil,
            photo_alt: nil,
            photo_position_x: 50,
            photo_position_y: 50
          },
          {
            id: second_user.id,
            name: "Second User",
            title: "Chief Instructor",
            photo_url: nil,
            photo_thumb_url: nil,
            photo_alt: nil,
            photo_position_x: 50,
            photo_position_y: 50
          }
        ]
      )
      expect(json[:team_members]).not_to include(include(name: hidden_user.full_name))
    end

    it "falls back to staff title when no public title override is set" do
      create(
        :user,
        :employee,
        first_name: "Nadia",
        last_name: "Petrovic",
        staff_title: "Chief Flight Instructor",
        public_team_enabled: true,
        public_team_title: nil
      )

      get "/api/v1/team_members"

      expect(response).to have_http_status(:ok)
      expect(json[:team_members]).to include(
        hash_including(
          name: "Nadia Petrovic",
          title: "Chief Flight Instructor",
          photo_url: nil,
          photo_thumb_url: nil,
          photo_alt: nil,
          photo_position_x: 50,
          photo_position_y: 50
        )
      )
    end

    it "returns optimized photo URLs for public team portraits" do
      user = create(
        :user,
        :employee,
        first_name: "Mindy",
        last_name: "Wilson",
        staff_title: "Chief Pilot",
        public_team_enabled: true,
        public_team_title: "Certified Flight Instructor, Chief Pilot",
        public_team_photo_position_x: 47,
        public_team_photo_position_y: 28
      )
      user.public_team_photo.attach(
        io: File.open(photo_path),
        filename: "team_photo.png",
        content_type: "image/png"
      )

      get "/api/v1/team_members"

      expect(response).to have_http_status(:ok)
      member = json[:team_members].first
      expect(member).to include(
        id: user.id,
        name: "Mindy Wilson",
        title: "Certified Flight Instructor, Chief Pilot",
        photo_alt: "Mindy Wilson, Certified Flight Instructor, Chief Pilot at AIRE Services Guam",
        photo_position_x: 47,
        photo_position_y: 28
      )
      expect(member[:photo_url]).to include("/rails/active_storage/representations")
      expect(member[:photo_thumb_url]).to include("/rails/active_storage/representations")
    end
  end

  describe "POST /api/v1/admin/users/:id/public_team_photo" do
    let(:admin) { create(:user, :admin) }
    let(:employee) do
      create(
        :user,
        :employee,
        first_name: "Mindy",
        last_name: "Wilson",
        staff_title: "Chief Pilot",
        public_team_enabled: true,
        public_team_title: "Certified Flight Instructor, Chief Pilot"
      )
    end

    it "allows admins to upload and remove a public team photo" do
      post "/api/v1/admin/users/#{employee.id}/public_team_photo",
           params: { photo: Rack::Test::UploadedFile.new(photo_path, "image/png") },
           headers: { "Authorization" => "Bearer test_token_#{admin.id}" }

      expect(response).to have_http_status(:ok)
      expect(employee.reload.public_team_photo).to be_attached
      expect(json.dig(:user, :public_team_photo_url)).to include("/rails/active_storage/blobs")
      expect(json.dig(:user, :public_team_photo_thumb_url)).to include("/rails/active_storage/representations")

      delete "/api/v1/admin/users/#{employee.id}/public_team_photo",
             headers: { "Authorization" => "Bearer test_token_#{admin.id}" }

      expect(response).to have_http_status(:ok)
      expect(employee.reload.public_team_photo).not_to be_attached
      expect(json.dig(:user, :public_team_photo_url)).to be_nil
    end

    it "rejects non-image public team photo uploads" do
      post "/api/v1/admin/users/#{employee.id}/public_team_photo",
           params: { photo: Rack::Test::UploadedFile.new(text_path, "text/plain") },
           headers: { "Authorization" => "Bearer test_token_#{admin.id}" }

      expect(response).to have_http_status(:unprocessable_entity)
      expect(json.fetch(:error)).to match(/valid image file/i)
      expect(employee.reload.public_team_photo).not_to be_attached
    end
  end
end
