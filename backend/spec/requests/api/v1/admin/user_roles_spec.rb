# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Assigning roles on the Team page", type: :request do
  let!(:owner) { create(:user, :owner, first_name: "Leon") }
  let!(:admin) { create(:user, :admin, first_name: "Chels") }
  let(:other_admin) { create(:user, :admin, first_name: "Second") }
  let(:manager) { create(:user, :manager, first_name: "Roke") }
  let(:employee) { create(:user, :employee, first_name: "Ana") }

  def headers_for(user)
    { "Authorization" => "Bearer test_token_#{user.id}" }
  end

  def json
    response.parsed_body
  end

  def change_role(actor, target, role)
    patch "/api/v1/admin/users/#{target.id}", params: { role: role }, headers: headers_for(actor)
  end

  describe "as an owner" do
    it "assigns every role and audits each change with actor, target and before/after" do
      change_role(owner, employee, "admin")
      expect(response).to have_http_status(:ok)
      change_role(owner, employee, "owner")
      expect(response).to have_http_status(:ok)
      change_role(owner, employee, "manager")
      expect(response).to have_http_status(:ok)
      expect(employee.reload.role).to eq("manager")

      rows = AuditLog.where(action: "user.role_changed", auditable: employee).order(:id)
      expect(rows.map { |row| row.changes_made["role"] }).to eq([ %w[employee admin], %w[admin owner], %w[owner manager] ])
      expect(rows.map(&:user_id).uniq).to eq([ owner.id ])
      expect(rows.first.metadata).to include("target_user_id" => employee.id, "target_name" => employee.full_name)
    end

    it "sees all four roles in the picker for everyone else, and none for themself" do
      get "/api/v1/admin/users", headers: headers_for(owner)
      rows = json.fetch("users").index_by { |row| row["id"] }
      expect(rows.fetch(admin.id)["assignable_roles"]).to eq(%w[owner admin manager employee])
      expect(rows.fetch(owner.id)["assignable_roles"]).to eq([])
    end

    it "can never demote, terminate or remove sign-in from the last active owner" do
      second_owner = create(:user, :owner)
      change_role(second_owner, owner, "admin")
      expect(response).to have_http_status(:ok)

      change_role(owner, second_owner, "admin")
      expect(response).to have_http_status(:forbidden)
      expect(second_owner.reload.role).to eq("owner")

      post "/api/v1/admin/users/#{second_owner.id}/terminate", headers: headers_for(owner)
      expect(response).to have_http_status(:forbidden)

      # The last owner can only be changed by an owner, and owners can't change themselves.
      change_role(second_owner, second_owner, "admin")
      expect(response).to have_http_status(:unprocessable_entity)
      expect(second_owner.reload.role).to eq("owner")
    end
  end

  describe "as an admin" do
    it "moves people between manager and employee only" do
      change_role(admin, employee, "manager")
      expect(response).to have_http_status(:ok)
      expect(employee.reload.role).to eq("manager")
      change_role(admin, employee, "employee")
      expect(response).to have_http_status(:ok)
      expect(AuditLog.where(action: "user.role_changed", auditable: employee, user: admin).count).to eq(2)
    end

    it "can't assign owner or admin, or change an owner's or admin's role" do
      %w[owner admin].each do |role|
        change_role(admin, employee, role)
        expect(response).to have_http_status(:forbidden)
        expect(json["error"]).to eq("Only an owner can assign or change the owner and admin roles")
      end
      change_role(admin, other_admin, "manager")
      expect(response).to have_http_status(:forbidden)
      change_role(admin, owner, "employee")
      expect(response).to have_http_status(:forbidden)

      expect([ employee, other_admin, owner ].map { |user| user.reload.role }).to eq(%w[employee admin owner])
      expect(AuditLog.where(action: "user.role_changed").count).to eq(0)
    end

    it "can't create an owner or admin" do
      post "/api/v1/admin/users", params: { role: "admin", email: "new.admin@example.com", personal_access_enabled: true, send_invitation: false }, headers: headers_for(admin)
      expect(response).to have_http_status(:forbidden)
      expect(User.find_by(email: "new.admin@example.com")).to be_nil

      post "/api/v1/admin/users", params: { role: "manager", email: "new.manager@example.com", personal_access_enabled: true, send_invitation: false }, headers: headers_for(admin)
      expect(response).to have_http_status(:created)
      expect(json.dig("user", "role")).to eq("manager")
    end

    it "can't terminate, reactivate, delete or remove sign-in for an owner or admin" do
      [ owner, other_admin ].each do |target|
        post "/api/v1/admin/users/#{target.id}/terminate", headers: headers_for(admin)
        expect(response).to have_http_status(:forbidden)
        patch "/api/v1/admin/users/#{target.id}", params: { personal_access_enabled: false }, headers: headers_for(admin)
        expect(response).to have_http_status(:forbidden)
        post "/api/v1/admin/users/#{target.id}/reactivate", headers: headers_for(admin)
        expect(response).to have_http_status(:forbidden)
        delete "/api/v1/admin/users/#{target.id}", headers: headers_for(admin)
        expect(response).to have_http_status(:forbidden)
        expect(target.reload).to have_attributes(is_active: true, personal_access_enabled: true)
      end
      expect(AuditLog.where(action: "authorization.owner_denied", user: admin).count).to eq(8)
    end

    it "still edits an admin's other details" do
      patch "/api/v1/admin/users/#{other_admin.id}", params: { staff_title: "Office manager" }, headers: headers_for(admin)
      expect(response).to have_http_status(:ok)
      expect(other_admin.reload.staff_title).to eq("Office manager")
    end

    it "sees manager and employee in the picker for staff, and nothing for owners and admins" do
      [ employee, manager, other_admin ]
      get "/api/v1/admin/users", headers: headers_for(admin)
      rows = json.fetch("users").index_by { |row| row["id"] }
      expect(rows.fetch(employee.id)["assignable_roles"]).to eq(%w[manager employee])
      expect(rows.fetch(manager.id)["assignable_roles"]).to eq(%w[manager employee])
      expect(rows.fetch(owner.id)).to include("assignable_roles" => [], "can_change_access" => false)
      expect(rows.fetch(other_admin.id)).to include("assignable_roles" => [], "can_change_access" => false)
    end
  end

  it "requires managers to sign in personally" do
    kiosk_only = create(:user, :employee, :kiosk_only)
    patch "/api/v1/admin/users/#{kiosk_only.id}", params: { role: "manager" }, headers: headers_for(owner)
    expect(response).to have_http_status(:unprocessable_entity)
    expect(json["error"]).to eq("Managers must keep personal sign-in enabled")
  end

  it "refuses role changes to managers and employees" do
    change_role(manager, employee, "manager")
    expect(response).to have_http_status(:forbidden)
    change_role(employee, employee, "admin")
    expect(response).to have_http_status(:forbidden)
    expect(employee.reload.role).to eq("employee")
  end
end
