# frozen_string_literal: true

require "rails_helper"

RSpec.describe "My Pay switches on the Team page", type: :request do
  let(:owner) { create(:user, :owner) }
  let(:admin) { create(:user, :admin) }
  let(:manager) { create(:user, :manager) }
  let(:worker) { create(:user, :employee) }

  def headers_for(user)
    { "Authorization" => "Bearer test_token_#{user.id}" }
  end

  def my_pay_visible_to?(user)
    get "/api/v1/auth/me", headers: headers_for(user)
    response.parsed_body.dig("user", "my_pay_enabled")
  end

  it "turns one person's My Pay on and off and audits each change" do
    expect(my_pay_visible_to?(worker)).to be(false)

    patch "/api/v1/admin/users/#{worker.id}/my_pay", params: { enabled: true }, headers: headers_for(admin)
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).to eq("user_id" => worker.id, "my_pay_enabled" => true, "my_pay_active" => true, "admin_edit_version" => 1)
    expect(my_pay_visible_to?(worker)).to be(true)

    patch "/api/v1/admin/users/#{worker.id}/my_pay", params: { enabled: false }, headers: headers_for(owner)
    expect(my_pay_visible_to?(worker)).to be(false)

    rows = AuditLog.where(action: "user.my_pay_access_changed", auditable: worker).order(:id)
    expect(rows.map { |row| [ row.user_id, row.changes_made["my_pay_enabled"] ] }).to eq([ [ admin.id, [ false, true ] ], [ owner.id, [ true, false ] ] ])
  end

  it "checks the loaded version and returns the new version for the next person edit" do
    patch "/api/v1/admin/users/#{worker.id}/my_pay", params: { enabled: true, admin_edit_version: 0 }, headers: headers_for(admin)
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["admin_edit_version"]).to eq(1)
    patch "/api/v1/admin/users/#{worker.id}/my_pay", params: { enabled: false, admin_edit_version: 0 }, headers: headers_for(admin)
    expect(response).to have_http_status(:conflict)
    expect(response.parsed_body["error"]).to eq(AdminPersonEdit::MESSAGE)
    expect(worker.reload).to have_attributes(my_pay_enabled: true, admin_edit_version: 1)
    expect(AuditLog.where(action: "user.my_pay_access_changed", auditable: worker).count).to eq(1)
    patch "/api/v1/admin/users/#{worker.id}", params: { staff_title: "Instructor", admin_edit_version: 1 }, headers: headers_for(admin)
    expect(response).to have_http_status(:ok)
    expect(worker.reload).to have_attributes(staff_title: "Instructor", admin_edit_version: 2)
  end

  it "writes no audit row when the switch is already in the requested state" do
    patch "/api/v1/admin/users/#{worker.id}/my_pay", params: { enabled: false }, headers: headers_for(admin)
    expect(response).to have_http_status(:ok)
    expect(AuditLog.where(action: "user.my_pay_access_changed").count).to eq(0)
  end

  it "opens and closes My Pay for everyone, audited with before/after" do
    patch "/api/v1/admin/my_pay_access", params: { enabled_for_all: true }, headers: headers_for(admin)
    expect(response.parsed_body).to include("enabled_for_all" => true)
    expect(my_pay_visible_to?(worker)).to be(true)
    expect(my_pay_visible_to?(manager)).to be(true)

    patch "/api/v1/admin/my_pay_access", params: { enabled_for_all: false }, headers: headers_for(owner)
    expect(my_pay_visible_to?(worker)).to be(false)

    rows = AuditLog.where(action: "setting.my_pay_everyone_updated").order(:id)
    expect(rows.map { |row| [ row.user_id, row.changes_made["my_pay_enabled_for_all"] ] }).to eq([ [ admin.id, [ false, true ] ], [ owner.id, [ true, false ] ] ])
  end

  it "keeps per-person switches when everyone is turned off again" do
    worker.update!(my_pay_enabled: true)
    patch "/api/v1/admin/my_pay_access", params: { enabled_for_all: true }, headers: headers_for(admin)
    patch "/api/v1/admin/my_pay_access", params: { enabled_for_all: false }, headers: headers_for(admin)
    get "/api/v1/admin/my_pay_access", headers: headers_for(admin)
    expect(response.parsed_body).to eq("enabled_for_all" => false, "enabled_user_ids" => [ worker.id ])
  end

  [ false, true ].each do |terminated|
    it "refuses to enable My Pay for an inactive person (terminated=#{terminated})" do
      worker.update_columns(is_active: false, terminated_at: terminated ? Time.current : nil)
      patch "/api/v1/admin/users/#{worker.id}/my_pay", params: { enabled: true }, headers: headers_for(admin)
      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.parsed_body["error"]).to eq("Reactivate this person before turning on My Pay.")
      expect(worker.reload).to have_attributes(my_pay_enabled: false, admin_edit_version: 0)
      expect(AuditLog.where(auditable: worker, action: "user.my_pay_access_changed")).to be_empty
      # Turning off stale access remains safe and available to existing callers.
      worker.update_columns(my_pay_enabled: true)
      patch "/api/v1/admin/users/#{worker.id}/my_pay", params: { enabled: false }, headers: headers_for(admin)
      expect(response).to have_http_status(:ok)
      expect(worker.reload.my_pay_enabled).to be(false)
    end
  end

  it "never shows My Pay to an inactive person" do
    worker.update!(my_pay_enabled: true)
    expect(Setting.my_pay_enabled_for?(worker)).to be(true)
    worker.update_columns(is_active: false)
    expect(Setting.my_pay_enabled_for?(worker.reload)).to be(false)
  end

  it "rejects values that aren't true or false" do
    patch "/api/v1/admin/users/#{worker.id}/my_pay", params: { enabled: "maybe" }, headers: headers_for(admin)
    expect(response).to have_http_status(:unprocessable_entity)
    patch "/api/v1/admin/my_pay_access", params: {}, headers: headers_for(admin)
    expect(response).to have_http_status(:unprocessable_entity)
  end

  it "refuses managers and employees, and the service refuses them too" do
    [ manager, worker ].each do |user|
      patch "/api/v1/admin/users/#{worker.id}/my_pay", params: { enabled: true }, headers: headers_for(user)
      expect(response).to have_http_status(:forbidden)
    end
    expect { MyPayAccess.set_for_user!(user: worker, enabled: true, actor: manager) }.to raise_error(MyPayAccess::NotPermitted)
    expect { MyPayAccess.set_for_all!(enabled: true, actor: worker) }.to raise_error(MyPayAccess::NotPermitted)
    expect(worker.reload.my_pay_enabled).to be(false)
  end
end
