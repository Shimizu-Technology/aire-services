# frozen_string_literal: true

require "rails_helper"
require_relative "../support/fake_worker_statements"

RSpec.describe "Kiosk pay stub requests", type: :request do
  include_context "fake worker statements"

  let!(:admin) { create(:user, :admin) }
  let(:kiosk_access_token) { AireKioskAccessToken.issue_for(admin) }
  let!(:employee) do
    create(:user, :employee, first_name: "Mindy", email: "mindy@example.com", time_tracking_enabled: true, kiosk_enabled: true).tap do |user|
      user.skip_kiosk_pin_presence_validation = true
      user.rotate_kiosk_pin!("731248")
    end
  end
  let(:kiosk_token) { AireKioskToken.issue_for(employee) }
  let(:tokens) { { kiosk_access_token: kiosk_access_token, kiosk_token: kiosk_token } }

  before do
    Setting.set(Setting::PAY_STUB_KIOSK_REQUESTS_KEY, "true")
    stub_statements(employee,
      statement_row(42, pay_date: "2026-11-15"),
      statement_row(40, pay_date: "2026-10-31", status: "voided"),
      statement_row(30, pay_date: "2025-12-31"))
  end

  it "is off until it's turned on in Settings" do
    Setting.set(Setting::PAY_STUB_KIOSK_REQUESTS_KEY, "false")
    post "/api/v1/aire/kiosk/verify", params: { pin: "731248", kiosk_access_token: kiosk_access_token }
    expect(response.parsed_body["pay_stub_requests_enabled"]).to be(false)

    post "/api/v1/aire/kiosk/pay_stubs/choices", params: tokens
    expect(response).to have_http_status(:not_found)
    post "/api/v1/aire/kiosk/pay_stubs", params: tokens.merge(scope: "latest")
    expect(response).to have_http_status(:not_found)
    expect(response.parsed_body["code"]).to eq("kiosk_requests_off")
    expect(PayDocumentRequest.count).to eq(0)
    expect(cornerstone_requests).to be_empty

    Setting.set(Setting::PAY_STUB_KIOSK_REQUESTS_KEY, "true")
    post "/api/v1/aire/kiosk/verify", params: { pin: "731248", kiosk_access_token: kiosk_access_token }
    expect(response.parsed_body["pay_stub_requests_enabled"]).to be(true)
  end

  it "offers pay dates only, without voided checks, and a masked email" do
    post "/api/v1/aire/kiosk/pay_stubs/choices", params: tokens

    expect(response).to have_http_status(:ok)
    body = response.parsed_body
    expect(body["pay_dates"]).to eq([ { "statement_id" => "42", "pay_date" => "2026-11-15" }, { "statement_id" => "30", "pay_date" => "2025-12-31" } ])
    expect(body["years"]).to eq([ 2026, 2025 ])
    expect(body["on_file_email_hint"]).to eq("m•••@example.com")
    expect(response.body).not_to include("mindy@example.com", "period")
    expect_no_pay_details(response.body)
  end

  it "requires an unlocked kiosk and a verified PIN" do
    post "/api/v1/aire/kiosk/pay_stubs/choices", params: { kiosk_access_token: kiosk_access_token, kiosk_token: "forged" }
    expect(response).to have_http_status(:unprocessable_entity)
    post "/api/v1/aire/kiosk/pay_stubs", params: { kiosk_access_token: "forged", kiosk_token: kiosk_token, scope: "latest" }
    expect(response).to have_http_status(:unprocessable_entity)
    expect(PayDocumentRequest.count).to eq(0)
    expect(cornerstone_requests).to be_empty
  end

  it "records a request for the latest stub to the email on file" do
    post "/api/v1/aire/kiosk/pay_stubs", params: tokens.merge(scope: "latest")

    expect(response).to have_http_status(:created)
    expect(response.parsed_body).to eq("message" => "Your request was sent to the office.")
    request = PayDocumentRequest.sole
    expect(request).to have_attributes(user_id: employee.id, source: "kiosk", scope: "latest", recipient_kind: "on_file", recipient_email: nil, status: "open")
    audit = AuditLog.find_by(action: "pay_documents.request_created", outcome: "succeeded")
    expect(audit).to have_attributes(user_id: employee.id, source: "kiosk", auditable: request)
    expect(sent_mail).to be_empty
  end

  it "records a specific pay date, but not a voided or foreign one" do
    post "/api/v1/aire/kiosk/pay_stubs", params: tokens.merge(scope: "pay_date", statement_id: "42")
    expect(PayDocumentRequest.last).to have_attributes(scope: "pay_date", document_reference: "42", document_date: Date.new(2026, 11, 15))

    post "/api/v1/aire/kiosk/pay_stubs", params: tokens.merge(scope: "pay_date", statement_id: "40")
    expect(response.parsed_body["code"]).to eq("statement_voided")
    post "/api/v1/aire/kiosk/pay_stubs", params: tokens.merge(scope: "pay_date", statement_id: "99")
    expect(response.parsed_body["code"]).to eq("statement_not_found")
    expect(PayDocumentRequest.count).to eq(1)
    expect(AuditLog.where(action: "pay_documents.request_created", outcome: "denied").count).to eq(2)
  end

  it "records a whole year to an email typed twice" do
    post "/api/v1/aire/kiosk/pay_stubs", params: tokens.merge(scope: "year", year: "2025", email: "mindy.home@example.com", email_confirmation: "mindy.home@example.org")
    expect(response.parsed_body["code"]).to eq("email_mismatch")

    post "/api/v1/aire/kiosk/pay_stubs", params: tokens.merge(scope: "year", year: "2025", email: "mindy.home@example.com", email_confirmation: "MINDY.HOME@example.com")
    expect(response).to have_http_status(:created)
    expect(PayDocumentRequest.sole).to have_attributes(scope: "year", year: 2025, recipient_kind: "typed", recipient_email: "mindy.home@example.com")
  end

  it "tells the worker's own address when a request names another one" do
    post "/api/v1/aire/kiosk/pay_stubs", params: tokens.merge(scope: "year", year: "2025", email: "someone@example.com", email_confirmation: "someone@example.com")

    expect(response).to have_http_status(:created)
    alert = sent_mail.sole
    expect(alert[:to]).to eq([ "mindy@example.com" ])
    expect(alert[:text]).to include("A pay stub request was made at the kiosk to be sent to another address", "If this wasn't you, tell the office.")
    [ alert[:subject], alert[:html], alert[:text] ].each do |part|
      expect(part).not_to include("someone@example.com", "2025")
      expect_no_pay_details(part)
    end
    expect(AuditLog.find_by(action: "pay_documents.request_worker_alert_sent").metadata).to include("target_user_id" => employee.id)
  end

  it "doesn't alert anyone for a request to the email on file" do
    post "/api/v1/aire/kiosk/pay_stubs", params: tokens.merge(scope: "latest")
    expect(sent_mail).to be_empty
  end

  it "rejects a year in the future" do
    post "/api/v1/aire/kiosk/pay_stubs", params: tokens.merge(scope: "year", year: (Date.current.year + 1).to_s)
    expect(response.parsed_body["code"]).to eq("invalid_year")
  end

  it "needs a typed email from a kiosk-only worker with none on file" do
    kiosk_only = create(:user, :kiosk_only, kiosk_pin: "246813")
    params = { kiosk_access_token: kiosk_access_token, kiosk_token: AireKioskToken.issue_for(kiosk_only), scope: "latest" }
    post "/api/v1/aire/kiosk/pay_stubs/choices", params: params
    expect(response.parsed_body["on_file_email_hint"]).to be_nil
    expect(response.parsed_body["pay_dates_available"]).to be(false)

    post "/api/v1/aire/kiosk/pay_stubs", params: params
    expect(response.parsed_body["code"]).to eq("no_email_on_file")
    post "/api/v1/aire/kiosk/pay_stubs", params: params.merge(email: "pilot@example.com", email_confirmation: "pilot@example.com")
    expect(response).to have_http_status(:created)
    # No address on file to alert.
    expect(sent_mail).to be_empty
  end

  it "allows three requests a day per worker" do
    3.times do
      post "/api/v1/aire/kiosk/pay_stubs", params: tokens.merge(scope: "latest")
      expect(response).to have_http_status(:created)
    end
    post "/api/v1/aire/kiosk/pay_stubs", params: tokens.merge(scope: "latest")

    expect(response).to have_http_status(:too_many_requests)
    expect(PayDocumentRequest.count).to eq(3)
    expect(AuditLog.find_by(action: "pay_documents.request_created", outcome: "denied").metadata["reason"]).to eq("rate_limited")
  end

  it "sends a heads-up with no pay details when recipients are configured" do
    Setting.set(PayDocuments::REQUEST_NOTICE_SETTING, "office@example.com")
    post "/api/v1/aire/kiosk/pay_stubs", params: tokens.merge(scope: "pay_date", statement_id: "42")

    mail = sent_mail.sole
    expect(mail[:to]).to eq([ "office@example.com" ])
    expect(mail[:text]).to include("asked for the pay stub for one pay date at the kiosk")
    expect(mail[:text]).not_to include("2026-11-15", "Nov")
    expect_no_pay_details(mail[:html])
    expect(AuditLog.find_by(action: "pay_documents.request_notice_sent")).to be_present
  end

  it "keeps the request when the heads-up email fails" do
    Setting.set(PayDocuments::REQUEST_NOTICE_SETTING, "office@example.com")
    allow(StagingMailTransport).to receive(:deliver).and_raise(StandardError, "provider down")
    post "/api/v1/aire/kiosk/pay_stubs", params: tokens.merge(scope: "latest")
    expect(response).to have_http_status(:created)
    expect(PayDocumentRequest.count).to eq(1)
  end
end
