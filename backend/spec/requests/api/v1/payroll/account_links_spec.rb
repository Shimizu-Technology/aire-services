# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Payroll account links", type: :request do
  let(:secret) { "cornerstone-account-link-secret" }
  let(:admin) { create(:user, :admin, is_active: true, personal_access_enabled: true) }
  let(:service_headers) { { "X-Payroll-Shared-Secret" => secret } }
  let(:admin_headers) { { "Authorization" => "Bearer test_token_#{admin.id}" } }

  around do |example|
    previous_secret = ENV["PAYROLL_SHARED_SECRET"]
    previous_frontend = ENV["FRONTEND_URL"]
    ENV["PAYROLL_SHARED_SECRET"] = secret
    ENV["FRONTEND_URL"] = "https://aire.example.com"
    example.run
  ensure
    ENV["PAYROLL_SHARED_SECRET"] = previous_secret
    ENV["FRONTEND_URL"] = previous_frontend
  end

  it "walks an authenticated AIRE administrator through a one-time connection" do
    post "/api/v1/payroll/account_link_sessions",
         params: {
           external_actor_id: "cornerstone-user-42",
           external_actor_email: "chels@example.com",
           return_url: "https://payroll.example.com/time-tracking-sources?source_id=7"
         },
         headers: service_headers

    expect(response).to have_http_status(:created)
    authorization_url = response.parsed_body.fetch("authorization_url")
    token = Rack::Utils.parse_query(URI(authorization_url).query).fetch("token")

    get "/api/v1/payroll/account_link_sessions/#{CGI.escapeURIComponent(token)}", headers: admin_headers
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body.dig("account_link_session", "external_actor_email")).to eq("chels@example.com")
    expect(response.parsed_body.dig("account_link_session", "aire_user", "email")).to eq(admin.email)

    post "/api/v1/payroll/account_link_sessions/#{CGI.escapeURIComponent(token)}/authorize", headers: admin_headers
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body.dig("account_link", "connected")).to eq(true)
    expect(response.parsed_body.fetch("redirect_url")).to eq(
      "https://payroll.example.com/time-tracking-sources?source_id=7&aire_link=connected"
    )

    get "/api/v1/payroll/account_links/cornerstone-user-42", headers: service_headers
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body.fetch("account_link")).to include(
      "connected" => true,
      "aire_user_email" => admin.email
    )

    delete "/api/v1/payroll/account_links/cornerstone-user-42", headers: service_headers
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body.dig("account_link", "connected")).to eq(false)
  end

  it "rolls back authorization when the connected audit event cannot be written" do
    session = PayrollAccountLinkSession.issue!(
      external_actor_id: "cornerstone-user-atomic-connect",
      external_actor_email: "chels@example.com",
      return_url: "https://payroll.example.com/time-tracking-sources"
    )
    fail_audit_for("payroll_account_link.connected")

    post "/api/v1/payroll/account_link_sessions/#{CGI.escapeURIComponent(session.issued_token)}/authorize",
         headers: admin_headers

    expect(response).to have_http_status(:unprocessable_entity)
    expect(PayrollAccountLink.where(external_actor_id: "cornerstone-user-atomic-connect")).to be_empty
    expect(session.reload).to have_attributes(consumed_at: nil, linked_user_id: nil)
  end

  it "rolls back revocation when the disconnected audit event cannot be written" do
    link = PayrollAccountLink.create!(
      user: admin,
      external_actor_id: "cornerstone-user-atomic-disconnect",
      external_actor_email: "chels@example.com",
      linked_at: Time.current
    )
    fail_audit_for("payroll_account_link.disconnected")

    delete "/api/v1/payroll/account_links/#{link.external_actor_id}", headers: service_headers

    expect(response).to have_http_status(:unprocessable_entity)
    expect(link.reload).to have_attributes(active: true, revoked_at: nil)
  end

  it "requires service authentication to begin or inspect a connection" do
    post "/api/v1/payroll/account_link_sessions", params: { external_actor_id: "42" }
    expect(response).to have_http_status(:unauthorized)

    get "/api/v1/payroll/account_links/42"
    expect(response).to have_http_status(:unauthorized)
  end

  it "requires an AIRE administrator to approve the connection" do
    employee = create(:user, :employee, is_active: true, personal_access_enabled: true)
    post "/api/v1/payroll/account_link_sessions",
         params: {
           external_actor_id: "42",
           external_actor_email: "chels@example.com",
           return_url: "https://payroll.example.com/time-tracking-sources"
         },
         headers: service_headers
    token = Rack::Utils.parse_query(URI(response.parsed_body.fetch("authorization_url")).query).fetch("token")

    post "/api/v1/payroll/account_link_sessions/#{CGI.escapeURIComponent(token)}/authorize",
         headers: { "Authorization" => "Bearer test_token_#{employee.id}" }

    expect(response).to have_http_status(:forbidden)
    expect(PayrollAccountLink.count).to eq(0)
  end

  def fail_audit_for(action)
    allow(AuditLog).to receive(:record!).and_wrap_original do |original, **attributes|
      if attributes[:action] == action
        invalid_audit = AuditLog.new
        invalid_audit.errors.add(:base, "simulated audit failure")
        raise ActiveRecord::RecordInvalid, invalid_audit
      end

      original.call(**attributes)
    end
  end
end
