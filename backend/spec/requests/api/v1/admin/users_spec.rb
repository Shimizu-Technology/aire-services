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

    it "preserves role filtering when listing pending users" do
      pending_admin = create(:user, :admin, clerk_id: "pending_admin_123", is_active: true)
      pending_employee = create(:user, :employee, clerk_id: "pending_employee_123", is_active: true)

      get "/api/v1/admin/users",
          params: { role: "admin", status: "pending" },
          headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      expect(json[:users].map { |user| user[:id] }).to include(pending_admin.id)
      expect(json[:users].map { |user| user[:id] }).not_to include(pending_employee.id)
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

    it "updates public Team page profile fields" do
      patch "/api/v1/admin/users/#{employee.id}",
            params: {
              public_team_enabled: true,
              public_team_name: "Captain Test",
              public_team_title: "Certified Flight Instructor",
              public_team_sort_order: 2
            },
            headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      expect(json.dig(:user, :public_team_enabled)).to eq(true)
      expect(json.dig(:user, :public_team_name)).to eq("Captain Test")
      expect(json.dig(:user, :public_team_title)).to eq("Certified Flight Instructor")
      expect(json.dig(:user, :public_team_sort_order)).to eq(2)
      expect(employee.reload).to have_attributes(
        public_team_enabled: true,
        public_team_name: "Captain Test",
        public_team_title: "Certified Flight Instructor",
        public_team_sort_order: 2
      )
    end

    it "does not call Clerk when only public Team page fields change" do
      allow(ClerkUserService).to receive(:update_user!)

      patch "/api/v1/admin/users/#{employee.id}",
            params: {
              email: employee.email,
              first_name: employee.first_name,
              last_name: employee.last_name,
              public_team_enabled: true,
              public_team_title: "Certified Flight Instructor",
              public_team_sort_order: 0
            },
            headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      expect(ClerkUserService).not_to have_received(:update_user!)
      expect(employee.reload).to have_attributes(
        public_team_enabled: true,
        public_team_title: "Certified Flight Instructor",
        public_team_sort_order: 0
      )
    end

    it "requires a public title when showing a user on the Team page" do
      patch "/api/v1/admin/users/#{employee.id}",
            params: {
              public_team_enabled: true,
              public_team_title: ""
            },
            headers: auth_headers_for[admin]

      expect(response).to have_http_status(:unprocessable_entity)
      expect(json[:error]).to match(/public team title/i)
    end

    it "updates kiosk-only profile fields and assigned categories together" do
      kiosk_only_user = create(
        :user,
        :employee,
        email: nil,
        clerk_id: "pending_kiosk_123",
        first_name: "Initial",
        last_name: nil
      )
      category = create(:time_category, name: "Ground Training Hours")

      patch "/api/v1/admin/users/#{kiosk_only_user.id}",
            params: {
              first_name: "Updated",
              last_name: "Pilot",
              role: "employee",
              approval_group: "cfi",
              time_category_ids: [ category.id ]
            },
            headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      expect(json.dig(:user, :first_name)).to eq("Updated")
      expect(json.dig(:user, :last_name)).to eq("Pilot")
      expect(json.dig(:user, :email)).to be_nil
      expect(json.dig(:user, :time_category_ids)).to eq([ category.id ])
      expect(kiosk_only_user.reload).to have_attributes(
        first_name: "Updated",
        last_name: "Pilot",
        email: nil,
        approval_group: "cfi"
      )
      expect(kiosk_only_user.assigned_time_categories.pluck(:id)).to eq([ category.id ])
    end

    it "updates invited Clerk email and assigned categories together" do
      invited_user = create(
        :user,
        :employee,
        clerk_id: "pending_invite_123",
        first_name: nil,
        last_name: nil
      )
      category = create(:time_category, name: "Ground Training Hours")

      patch "/api/v1/admin/users/#{invited_user.id}",
            params: {
              email: "updated.pilot@example.com",
              role: "employee",
              approval_group: "cfi",
              time_category_ids: [ category.id ]
            },
            headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      expect(json.dig(:user, :email)).to eq("updated.pilot@example.com")
      expect(json.dig(:user, :uses_clerk_profile)).to eq(true)
      expect(json.dig(:user, :time_category_ids)).to eq([ category.id ])
      expect(invited_user.reload).to have_attributes(
        email: "updated.pilot@example.com",
        first_name: nil,
        last_name: nil,
        approval_group: "cfi"
      )
      expect(invited_user.assigned_time_categories.pluck(:id)).to eq([ category.id ])
    end

    it "does not allow clearing email for an activated Clerk user" do
      patch "/api/v1/admin/users/#{employee.id}",
            params: { email: "" },
            headers: auth_headers_for[admin]

      expect(response).to have_http_status(:unprocessable_entity)
      expect(json[:error]).to match(/must keep an email address/i)
      expect(employee.reload.email).to be_present
    end

    it "updates active Clerk profile fields through ClerkUserService" do
      allow(ClerkUserService).to receive(:update_user!).and_return(true)

      patch "/api/v1/admin/users/#{employee.id}",
            params: {
              first_name: "Updated",
              last_name: "User"
            },
            headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      expect(ClerkUserService).to have_received(:update_user!).with(
        clerk_user_id: employee.clerk_id,
        first_name: "Updated"
      )
      expect(employee.reload).to have_attributes(
        email: employee.email,
        first_name: "Updated",
        last_name: "User"
      )
    end

    it "rolls back local name changes when Clerk sync fails" do
      original_updated_at = employee.updated_at

      allow(ClerkUserService).to receive(:update_user!).and_raise(
        ClerkUserService::RequestError,
        "Clerk request failed: upstream unavailable"
      )

      patch "/api/v1/admin/users/#{employee.id}",
            params: {
              first_name: "Updated",
              public_team_enabled: true,
              public_team_title: "Certified Flight Instructor"
            },
            headers: auth_headers_for[admin]

      expect(response).to have_http_status(:unprocessable_entity)
      expect(json[:error]).to match(/upstream unavailable/i)
      expect(employee.reload).to have_attributes(
        first_name: "Test",
        public_team_enabled: false,
        public_team_title: nil
      )
      expect(employee.updated_at.to_i).to eq(original_updated_at.to_i)
    end

    it "does not allow changing email for an activated Clerk user" do
      patch "/api/v1/admin/users/#{employee.id}",
            params: { email: "new.email@example.com" },
            headers: auth_headers_for[admin]

      expect(response).to have_http_status(:unprocessable_entity)
      expect(json[:error]).to match(/update their email from Clerk/i)
      expect(employee.reload.email).not_to eq("new.email@example.com")
    end

    it "does not allow converting a kiosk-only user to email sign-in from the edit form" do
      kiosk_only_user = create(
        :user,
        :employee,
        email: nil,
        clerk_id: "pending_kiosk_456",
        first_name: "Initial"
      )

      patch "/api/v1/admin/users/#{kiosk_only_user.id}",
            params: { email: "new.invite@example.com" },
            headers: auth_headers_for[admin]

      expect(response).to have_http_status(:unprocessable_entity)
      expect(json[:error]).to match(/cannot be converted to email sign-in/i)
      expect(kiosk_only_user.reload.email).to be_nil
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
