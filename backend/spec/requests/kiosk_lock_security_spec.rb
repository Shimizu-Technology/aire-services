# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Kiosk device security", type: :request do
  let(:admin) { create(:user, :admin) }
  let(:employee) { create(:user, :employee) }
  let(:token) { AireKioskAccessToken.issue_for(admin) }

  before do
    admin.rotate_kiosk_pin!("864200")
    employee.rotate_kiosk_pin!("246810")
  end

  it "requires a manager PIN and revokes the device on lock" do
    post "/api/v1/aire/kiosk/lock", params: { kiosk_access_token: token, pin: "246810" }
    expect(response).to have_http_status(:forbidden)
    expect(AireKioskAccessToken.admin_from_token(token)).to eq(admin)
    post "/api/v1/aire/kiosk/lock", params: { kiosk_access_token: token, pin: "864200" }
    expect(response).to have_http_status(:no_content)
    expect(AireKioskAccessToken.admin_from_token(token)).to be_nil
    expect(AuditLog.where(action: "kiosk.locked").last.metadata["device_id"]).to be_present
  end

  it "does not accept either kiosk token as manager authentication" do
    [ token, AireKioskToken.issue_for(employee) ].each do |bearer|
      post "/api/v1/admin/kiosk_session", headers: { "Authorization" => "Bearer #{bearer}" }
      expect(response).to have_http_status(:unauthorized)
      get "/api/v1/time_entries/pending_approvals", headers: { "Authorization" => "Bearer #{bearer}" }
      expect(response).to have_http_status(:unauthorized)
    end
  end
  it "audits unknown lock PIN failures" do
    post "/api/v1/aire/kiosk/lock", params: { kiosk_access_token: token, pin: "000000" }
    expect(response).to have_http_status(:unprocessable_entity)
    expect(AuditLog.where(action: "kiosk.lock_failed", outcome: "failed").count).to eq(1)
  end

  it "counts a recognized but invalid PIN toward account lockout" do
    admin.update_columns(kiosk_pin_digest: BCrypt::Password.create("999999"))
    User::KIOSK_MAX_FAILED_ATTEMPTS.times do
      post "/api/v1/aire/kiosk/lock", params: { kiosk_access_token: token, pin: "864200" }
    end
    expect(admin.reload).to be_kiosk_locked
    expect(admin.kiosk_failed_attempts_count).to eq(User::KIOSK_MAX_FAILED_ATTEMPTS)
  end

  it "lets an administrator revoke all active devices and audits the count" do
    token
    second = AireKioskAccessToken.issue_for(admin)
    post "/api/v1/admin/kiosk_session/lock_all", headers: { "Authorization" => "Bearer test_token_#{admin.id}" }
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["revoked_count"]).to eq(2)
    expect(AireKioskAccessToken.device_from_token(token)).to be_nil
    expect(AireKioskAccessToken.device_from_token(second)).to be_nil
    expect(AuditLog.where(action: "kiosk.all_locked").last.metadata["revoked_count"]).to eq(2)
  end

  it "does not let an employee revoke other devices" do
    token
    post "/api/v1/admin/kiosk_session/lock_all", headers: { "Authorization" => "Bearer test_token_#{employee.id}" }
    expect(response).to have_http_status(:forbidden)
    expect(AireKioskAccessToken.device_from_token(token)).to be_present
  end

  it "revokes a device after failed sign-out without exposing manager access" do
    post "/api/v1/aire/kiosk/revoke", params: { kiosk_access_token: token }
    expect(response).to have_http_status(:no_content)
    expect(AireKioskAccessToken.device_from_token(token)).to be_nil
  end
end
