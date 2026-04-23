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

    it "does not persist admin-entered names for email-based users" do
      post "/api/v1/admin/users",
           params: {
             first_name: "Should",
             last_name: "Ignore",
             email: "invitee@example.com",
             role: "employee",
             send_invitation: false
           },
           headers: auth_headers_for[admin]

      expect(response).to have_http_status(:created)
      expect(json.dig(:user, :email)).to eq("invitee@example.com")
      expect(json.dig(:user, :first_name)).to be_nil
      expect(json.dig(:user, :last_name)).to be_nil
      expect(User.order(:id).last).to have_attributes(first_name: nil, last_name: nil)
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

  describe "GET /api/v1/admin/users" do
    it "keeps active and pending filters mutually exclusive" do
      active_user = create(:user, :employee, clerk_id: "clerk_active_1", is_active: true)
      pending_user = create(:user, :employee, clerk_id: "pending_123", is_active: true)
      inactive_user = create(:user, :employee, clerk_id: "clerk_inactive_1", is_active: false)

      get "/api/v1/admin/users",
          params: { status: "active" },
          headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      expect(json[:users].map { |user| user[:id] }).to include(active_user.id)
      expect(json[:users].map { |user| user[:id] }).not_to include(pending_user.id, inactive_user.id)

      get "/api/v1/admin/users",
          params: { status: "pending" },
          headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      expect(json[:users].map { |user| user[:id] }).to include(pending_user.id)
      expect(json[:users].map { |user| user[:id] }).not_to include(active_user.id, inactive_user.id)
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

    it "updates profile fields and assigned categories together" do
      category = create(:time_category, name: "Ground Training Hours")

      patch "/api/v1/admin/users/#{employee.id}",
            params: {
              first_name: "Updated",
              last_name: "Pilot",
              email: "updated.pilot@example.com",
              role: "employee",
              approval_group: "cfi",
              time_category_ids: [ category.id ]
            },
            headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      expect(json.dig(:user, :first_name)).to eq("Updated")
      expect(json.dig(:user, :last_name)).to eq("Pilot")
      expect(json.dig(:user, :email)).to eq("updated.pilot@example.com")
      expect(json.dig(:user, :time_category_ids)).to eq([ category.id ])
      expect(employee.reload).to have_attributes(
        first_name: "Updated",
        last_name: "Pilot",
        email: "updated.pilot@example.com",
        approval_group: "cfi"
      )
      expect(employee.assigned_time_categories.pluck(:id)).to eq([ category.id ])
    end

    it "deactivates another user" do
      patch "/api/v1/admin/users/#{employee.id}",
            params: { is_active: false },
            headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      expect(json.dig(:user, :is_active)).to eq(false)
      expect(employee.reload.is_active).to eq(false)
    end

    it "does not let admins deactivate themselves" do
      patch "/api/v1/admin/users/#{admin.id}",
            params: { is_active: false },
            headers: auth_headers_for[admin]

      expect(response).to have_http_status(:unprocessable_entity)
      expect(json[:error]).to match(/cannot deactivate your own account/i)
      expect(admin.reload.is_active).to eq(true)
    end
  end
end
