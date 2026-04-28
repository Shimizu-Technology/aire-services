# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Api::V1::Admin::KioskSessions", type: :request do
  let(:admin) { create(:user, :admin) }
  let(:employee) { create(:user, :employee) }

  let(:auth_headers_for) do
    ->(user) { { "Authorization" => "Bearer test_token_#{user.id}" } }
  end

  def json
    JSON.parse(response.body, symbolize_names: true)
  end

  it "lets an admin unlock the kiosk" do
    post "/api/v1/admin/kiosk_session", headers: auth_headers_for[admin]

    expect(response).to have_http_status(:created)
    expect(json[:kiosk_access_token]).to be_present
    expect(json.dig(:unlocked_by, :id)).to eq(admin.id)
  end

  it "blocks non-admin users" do
    post "/api/v1/admin/kiosk_session", headers: auth_headers_for[employee]

    expect(response).to have_http_status(:forbidden)
  end
end
