# frozen_string_literal: true

require "rails_helper"
require "combine_pdf"
require_relative "../../../support/fake_worker_statements"

RSpec.describe "Pay stub links", type: :request do
  include ActiveSupport::Testing::TimeHelpers
  include_context "fake worker statements"

  let(:admin) { create(:user, :admin) }
  let(:worker) { create(:user, :employee, first_name: "Mindy", last_name: "Cruz", email: "mindy@example.com") }
  let(:token) { PayDocumentDelivery.generate_token }
  let(:browser) { { "User-Agent" => "Mozilla/5.0 (iPhone) Safari", "REMOTE_ADDR" => "203.0.113.7" } }
  let!(:delivery) do
    PayDocumentDelivery.create!(user: worker, sent_by: admin, origin: "sender", recipient_email: "mindy@example.com", recipient_kind: "on_file",
      token_digest: PayDocumentDelivery.digest(token), expires_at: 7.days.from_now, max_downloads_per_document: 5, email_status: "sent")
  end
  let!(:latest) { delivery.pay_document_items.create!(kind: "pay_statement", reference: "42", document_date: Date.new(2026, 11, 15), period_start: Date.new(2026, 10, 26), period_end: Date.new(2026, 11, 8), position: 0) }
  let!(:earlier) { delivery.pay_document_items.create!(kind: "pay_statement", reference: "41", document_date: Date.new(2026, 10, 31), position: 1) }

  before do
    stub_statements(worker, statement_row(42, pay_date: "2026-11-15"), statement_row(41, pay_date: "2026-10-31"))
  end

  def lookup(value = token) = post("/api/v1/pay_stub_links/lookup", params: { token: value }, headers: browser)
  def download(item, value = token) = post("/api/v1/pay_stub_links/download", params: { token: value, document_id: item.id }, headers: browser)

  it "shows the employer, first name and pay dates, and nothing about pay" do
    lookup

    expect(response).to have_http_status(:ok)
    expect(response.headers["Cache-Control"]).to include("no-store")
    body = response.parsed_body
    expect(body).to include("state" => "active", "employer" => "AIRE Services Guam", "first_name" => "Mindy", "downloads_per_document" => 5)
    expect(body["documents"].map { |doc| doc["pay_date"] }).to eq(%w[2026-11-15 2026-10-31])
    expect(body["documents"].first.keys).to contain_exactly("id", "kind", "pay_date", "period_start", "period_end", "downloads_left")
    expect(response.body).not_to include("Cruz", "mindy@example.com")
    expect_no_pay_details(response.body)
    expect(cornerstone_requests).to be_empty
  end

  it "downloads a PDF fetched live from payroll and logs where it went" do
    download(latest)

    expect(response).to have_http_status(:ok)
    expect(response.media_type).to eq("application/pdf")
    expect(response.headers["Content-Disposition"]).to include("AIRE-pay-stub-2026-11-15.pdf")
    expect(response.body).to start_with("%PDF-")
    expect(cornerstone_requests).to include("/api/v1/integrations/time_payroll/workers/#{worker.payroll_integration_uuid}/statements/42/pdf")

    expect(latest.reload.download_count).to eq(1)
    log = PayDocumentDownload.sole
    expect(log).to have_attributes(pay_document_item_id: latest.id, ip_address: "203.0.113.7", user_agent: "Mozilla/5.0 (iPhone) Safari", bundled: false)
    audit = AuditLog.find_by(action: "pay_documents.link_downloaded")
    expect(audit).to have_attributes(ip_address: "203.0.113.7", user_agent: "Mozilla/5.0 (iPhone) Safari", auditable: delivery, outcome: "succeeded")
    expect(audit.metadata).to include("statement_id" => "42", "accessed_by" => "link_recipient", "downloads_used" => 1)
    expect(AuditLogPresenter.new(audit).summary).to eq("Link recipient downloaded a pay stub for Mindy Cruz")
  end

  it "stops each document at the download cap" do
    5.times do
      download(latest)
      expect(response).to have_http_status(:ok)
    end
    download(latest)

    expect(response).to have_http_status(:gone)
    expect(response.parsed_body["code"]).to eq("download_limit")
    expect(latest.reload.download_count).to eq(5)
    expect(AuditLog.where(action: "pay_documents.link_download_denied").last.metadata["reason"]).to eq("download_limit")

    download(earlier)
    expect(response).to have_http_status(:ok)
  end

  it "says when every download has been used" do
    delivery.pay_document_items.update_all(download_count: 5)
    lookup
    expect(response.parsed_body).to include("state" => "used_up", "documents" => [])
  end

  it "stops working after seven days" do
    travel_to(7.days.from_now + 1.minute) do
      lookup
      expect(response.parsed_body["state"]).to eq("expired")
      expect(response.parsed_body["documents"]).to eq([])

      download(latest)
      expect(response).to have_http_status(:gone)
      expect(response.parsed_body["code"]).to eq("link_expired")
    end
    expect(cornerstone_requests).to be_empty
  end

  it "stops working once revoked" do
    PayDocuments::LinkRevoker.revoke!(delivery: delivery, actor: admin)
    download(latest)

    expect(response).to have_http_status(:gone)
    expect(response.parsed_body["code"]).to eq("link_revoked")
    expect(AuditLog.find_by(action: "pay_documents.link_download_denied").metadata["reason"]).to eq("revoked")
  end

  it "doesn't work until its email is recorded as sent" do
    delivery.update!(email_status: "pending")
    lookup
    expect(response.parsed_body).to include("state" => "pending", "documents" => [])

    download(latest)
    expect(response).to have_http_status(:gone)
    expect(response.parsed_body["code"]).to eq("link_pending")
    expect(latest.reload.download_count).to eq(0)
    expect(cornerstone_requests).to be_empty
  end

  it "stops working for someone who no longer works here" do
    worker.update_columns(is_active: false)
    lookup
    expect(response.parsed_body).to include("state" => "inactive", "documents" => [])

    download(latest)
    expect(response).to have_http_status(:gone)
    expect(response.parsed_body["code"]).to eq("link_inactive")
    expect(AuditLog.find_by(action: "pay_documents.link_download_denied").metadata["reason"]).to eq("inactive")
    expect(cornerstone_requests).to be_empty
  end

  it "won't download a check that was voided after the link was sent, and refunds the attempt" do
    stub_statements(worker, statement_row(42, pay_date: "2026-11-15", status: "voided"), statement_row(41, pay_date: "2026-10-31"))
    download(latest)

    expect(response).to have_http_status(:gone)
    expect(response.parsed_body["code"]).to eq("document_unavailable")
    expect(latest.reload.download_count).to eq(0)
    expect(cornerstone_requests.grep(/pdf\z/)).to be_empty
    expect(PayDocumentDownload.count).to eq(0)
  end

  context "when payroll is down" do
    let(:cornerstone_down) { true }

    it "doesn't use up a download" do
      download(latest)
      expect(response).to have_http_status(:service_unavailable)
      expect(latest.reload.download_count).to eq(0)
    end
  end

  it "rejects unknown and malformed tokens" do
    lookup(PayDocumentDelivery.generate_token)
    expect(response).to have_http_status(:not_found)
    lookup("short")
    expect(response).to have_http_status(:not_found)
    expect(AuditLog.where(action: "pay_documents.link_download_denied", outcome: "denied").count).to eq(2)
  end

  it "won't download a document from another link" do
    other = PayDocumentDelivery.create!(user: worker, sent_by: admin, origin: "sender", recipient_email: "x@example.com", recipient_kind: "typed",
      token_digest: PayDocumentDelivery.digest(PayDocumentDelivery.generate_token), expires_at: 7.days.from_now, max_downloads_per_document: 5)
    foreign = other.pay_document_items.create!(kind: "pay_statement", reference: "41")
    download(foreign)
    expect(response).to have_http_status(:not_found)
  end

  it "downloads every stub as one PDF" do
    post "/api/v1/pay_stub_links/download_all", params: { token: token }, headers: browser

    expect(response).to have_http_status(:ok)
    expect(response.headers["Content-Disposition"]).to include("AIRE-pay-stubs-2026.pdf")
    expect(CombinePDF.parse(response.body).pages.size).to eq(2)
    expect(delivery.pay_document_items.reload.map(&:download_count)).to eq([ 1, 1 ])
    expect(PayDocumentDownload.where(bundled: true).count).to eq(2)
  end
end
