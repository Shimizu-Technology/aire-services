# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Api::V1::TeamMembers", type: :request do
  def json
    JSON.parse(response.body, symbolize_names: true)
  end

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
            name: "Captain First",
            title: "Certified Flight Instructor"
          },
          {
            name: "Second User",
            title: "Chief Instructor"
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
        {
          name: "Nadia Petrovic",
          title: "Chief Flight Instructor"
        }
      )
    end
  end
end
