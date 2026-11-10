# frozen_string_literal: true

require "rails_helper"
require_relative "../../../support/fake_worker_statements"

RSpec.describe "My Pay: email me this stub", type: :request do
  include_context "fake worker statements"

  let(:worker) { create(:user, :employee, first_name: "Mindy", email: "mindy@example.com", my_pay_enabled: true) }
  let(:other) { create(:user, :employee, my_pay_enabled: true) }
  let(:headers) { { "Authorization" => "Bearer test_token_#{worker.id}" } }

  before do
    stub_statements(worker, statement_row(42, pay_date: "2026-11-15"), statement_row(40, pay_date: "2026-10-31", status: "voided"))
    stub_statements(other, statement_row(99, pay_date: "2026-11-15"))
  end

  it "emails a link to the worker's own stub at the address on file" do
    post "/api/v1/my_pay/42/email", headers: headers

    expect(response).to have_http_status(:created)
    expect(response.parsed_body["sent_to"]).to eq("m•••@example.com")
    delivery = PayDocumentDelivery.sole
    expect(delivery).to have_attributes(origin: "self", sent_by_id: worker.id, user_id: worker.id, recipient_email: "mindy@example.com")
    expect(sent_mail.sole[:text]).to include("Here is the secure link you asked for in My Pay")
    expect_no_pay_details(sent_mail.sole[:html])
    expect(AuditLog.find_by(action: "pay_documents.link_sent", user: worker)).to be_present
  end

  it "won't email another worker's stub or a voided check" do
    post "/api/v1/my_pay/99/email", headers: headers
    expect(response).to have_http_status(:not_found)
    post "/api/v1/my_pay/40/email", headers: headers
    expect(response.parsed_body["code"]).to eq("statement_voided")
    expect(PayDocumentDelivery.count).to eq(0)
  end

  it "only sends to the email on file" do
    post "/api/v1/my_pay/42/email", params: { email: "someone@example.com", email_confirmation: "someone@example.com" }, headers: headers
    expect(PayDocumentDelivery.sole.recipient_email).to eq("mindy@example.com")
  end

  it "follows the My Pay switch" do
    worker.update!(my_pay_enabled: false)
    post "/api/v1/my_pay/42/email", headers: headers
    expect(response).to have_http_status(:forbidden)
    expect(cornerstone_requests).to be_empty
  end

  it "allows five a day" do
    5.times do
      post "/api/v1/my_pay/42/email", headers: headers
      expect(response).to have_http_status(:created)
    end
    post "/api/v1/my_pay/42/email", headers: headers
    expect(response).to have_http_status(:too_many_requests)
  end
end
