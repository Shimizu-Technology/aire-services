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
end
