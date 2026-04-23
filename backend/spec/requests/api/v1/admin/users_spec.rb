# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Api::V1::Admin::Users", type: :request do
  let(:admin) { create(:user, :admin) }
  let(:employee) { create(:user, :employee) }

  let(:auth_headers_for) do
    ->(user) { { "Authorization" => "Bearer test_token_#{user.id}" } }
  end

  def json
    JSON.parse(response.body, symbolize_names: true)
  end

  describe "POST /api/v1/admin/users" do
    it "creates a user with an approval group" do
      post "/api/v1/admin/users",
           params: {
             first_name: "Cfi",
             last_name: "Pilot",
             email: "cfi@example.com",
             role: "employee",
             approval_group: "cfi",
             send_invitation: false
           },
           headers: auth_headers_for[admin]

      expect(response).to have_http_status(:created)
      expect(json.dig(:user, :approval_group)).to eq("cfi")
      expect(json.dig(:user, :approval_group_label)).to eq("CFI")
    end

    it "rejects an invalid approval group" do
      post "/api/v1/admin/users",
           params: {
             first_name: "Invalid",
             role: "employee",
             approval_group: "bad_value",
             send_invitation: false
           },
           headers: auth_headers_for[admin]

      expect(response).to have_http_status(:unprocessable_entity)
      expect(json[:error]).to match(/Approval group/)
    end
  end

  describe "PATCH /api/v1/admin/users/:id" do
    it "updates approval group" do
      patch "/api/v1/admin/users/#{employee.id}",
            params: { approval_group: "ops_maintenance" },
            headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      expect(json.dig(:user, :approval_group)).to eq("ops_maintenance")
      expect(employee.reload.approval_group).to eq("ops_maintenance")
    end

    it "allows clearing approval group" do
      employee.update!(approval_group: "cfi")

      patch "/api/v1/admin/users/#{employee.id}",
            params: { approval_group: "unassigned" },
            headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      expect(json.dig(:user, :approval_group)).to be_nil
      expect(employee.reload.approval_group).to be_nil
    end
  end
end
