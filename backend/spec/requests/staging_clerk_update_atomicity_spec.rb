# frozen_string_literal: true

require "rails_helper"

RSpec.describe "shared staging Clerk edit atomicity", type: :request do
  around do |example|
    old = ENV.to_h
    example.run
  ensure
    ENV.replace(old)
  end

  it "refuses shared tester profile edits before persisting names, local fields or approval assignments" do
    admin = create(:user, :admin, clerk_id: "user_originaladmin")
    tester = create(:user, clerk_id: "user_originaltester")
    ENV.update("DEPLOYMENT_ENV" => "staging", "STAGING_SHARES_PRODUCTION_CLERK" => "true", "STAGING_SHARES_PRODUCTION_STORAGE" => "true", "STAGING_STORAGE_WRITE_PREFIX" => "staging/2026-10-25/", "CLERK_SECRET_KEY" => "sk_test_synthetic", "STAGING_TESTER_BINDINGS" => [ { user_id: admin.id, email: admin.email, clerk_subject: admin.clerk_id }, { user_id: tester.id, email: tester.email, clerk_subject: tester.clerk_id } ].to_json)
    original = tester.attributes
    expect(ClerkUserService).not_to receive(:update_user!)
    expect(HTTParty).not_to receive(:send)
    patch "/api/v1/admin/users/#{tester.id}", params: { first_name: "Must not save", public_team_enabled: true, public_team_title: "Must not save" }, headers: { "Authorization" => "Bearer test_token_#{admin.id}" }
    expect(tester.reload.attributes).to eq(original)
    expect(response).to have_http_status(:service_unavailable)
    expect(response.parsed_body.fetch("error")).to include("shared production staging")
  end
end
