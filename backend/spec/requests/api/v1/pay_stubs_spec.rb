# frozen_string_literal: true

require "rails_helper"
require_relative "../../../support/fake_worker_statements"

RSpec.describe "Pay stub sending", type: :request do
  include_context "fake worker statements"

  let(:owner) { create(:user, :owner) }
  let(:admin) { create(:user, :admin) }
  let(:manager) { create(:user, :manager) }
  let(:employee) { create(:user, :employee) }
  let(:worker) { create(:user, :employee, first_name: "Mindy", last_name: "Cruz", email: "mindy@example.com") }

  def auth(user) = { "Authorization" => "Bearer test_token_#{user.id}" }

  before do
    stub_statements(worker,
      statement_row(42, pay_date: "2026-11-15"),
      statement_row(41, pay_date: "2026-10-31"),
      statement_row(40, pay_date: "2026-10-15", status: "voided"),
      statement_row(30, pay_date: "2025-12-31"))
  end

  describe "who can send" do
    it "lets owners, admins and managers in and keeps employees out" do
      [ owner, admin, manager ].each do |user|
        get "/api/v1/pay_stubs/workers", headers: auth(user)
        expect(response).to have_http_status(:ok), "#{user.role} should be allowed"
      end

      get "/api/v1/pay_stubs/workers", headers: auth(employee)
      expect(response).to have_http_status(:forbidden)
      post "/api/v1/pay_stubs/links", params: { user_id: worker.id, statement_ids: [ "42" ] }, headers: auth(employee)
      expect(response).to have_http_status(:forbidden)
      expect(PayDocumentDelivery.count).to eq(0)
      expect(AuditLog.where(action: "authorization.supervisor_denied", user: employee)).to exist
    end

    it "requires sign-in" do
      get "/api/v1/pay_stubs/requests"
      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "picking stubs" do
    it "shows a manager check dates and periods but no amounts, identifiers or run purpose" do
      get "/api/v1/pay_stubs/workers/#{worker.id}/statements", headers: auth(manager)

      expect(response).to have_http_status(:ok)
      statements = response.parsed_body.fetch("statements")
      expect(statements.map { |row| row["id"] }).to eq(%w[42 41 40 30])
      expect(statements.first.keys).to contain_exactly("id", "pay_date", "period_start", "period_end", "voided")
      expect(statements.find { |row| row["id"] == "40" }["voided"]).to be(true)
      expect(response.body).not_to include("regular")
      expect_no_pay_details(response.body)
    end

    it "shows owners and admins the run purpose" do
      get "/api/v1/pay_stubs/workers/#{worker.id}/statements", headers: auth(admin)
      expect(response.parsed_body.fetch("statements").first).to include("run_purpose" => "regular")
    end

    it "masks the email on file for managers and shows it to owners and admins" do
      get "/api/v1/pay_stubs/workers/#{worker.id}", headers: auth(manager)
      expect(response.parsed_body.dig("worker", "on_file_email")).to eq("m•••@example.com")
      get "/api/v1/pay_stubs/workers", headers: auth(manager)
      expect(response.parsed_body["can_choose_recipient"]).to be(false)
      expect(response.body).not_to include("mindy@example.com")

      get "/api/v1/pay_stubs/workers/#{worker.id}", headers: auth(admin)
      expect(response.parsed_body.dig("worker", "on_file_email")).to eq("mindy@example.com")
      get "/api/v1/pay_stubs/workers", headers: auth(admin)
      expect(response.parsed_body["can_choose_recipient"]).to be(true)
    end

    context "when payroll can't be reached" do
      let(:cornerstone_down) { true }

      it "says so" do
        get "/api/v1/pay_stubs/workers/#{worker.id}/statements", headers: auth(manager)
        expect(response).to have_http_status(:service_unavailable)
        expect(response.parsed_body["code"]).to eq("payroll_unavailable")
      end
    end
  end

  describe "sending a link" do
    it "emails a link with no pay details and stores only the token digest" do
      post "/api/v1/pay_stubs/links", params: { user_id: worker.id, statement_ids: %w[42 41] }, headers: auth(manager)

      expect(response).to have_http_status(:created)
      expect_no_pay_details(response.body)
      delivery = PayDocumentDelivery.last
      expect(delivery).to have_attributes(user_id: worker.id, sent_by_id: manager.id, origin: "sender", recipient_kind: "on_file",
        recipient_email: "mindy@example.com", email_status: "sent", max_downloads_per_document: 5)
      expect(delivery.expires_at).to be_within(1.minute).of(7.days.from_now)
      expect(delivery.pay_document_items.map(&:reference)).to eq(%w[42 41])
      expect(delivery.pay_document_items.first.document_date).to eq(Date.new(2026, 11, 15))

      mail = sent_mail.sole
      expect(mail[:to]).to eq([ "mindy@example.com" ])
      token = mail[:text][%r{/stubs#t=([A-Za-z0-9_-]{43})}, 1]
      expect(token).to be_present
      expect(delivery.token_digest).to eq(Digest::SHA256.hexdigest(token))
      expect(PayDocumentDelivery.column_names).not_to include("token")
      [ mail[:subject], mail[:html], mail[:text] ].each do |part|
        expect_no_pay_details(part)
        expect(part).not_to include("2026-11-15", "Nov 15", "November 15")
      end
      expect(mail[:text]).to include("Hi Mindy", "2 of your pay stubs", "up to 5 times")

      audit = AuditLog.find_by(action: "pay_documents.link_sent")
      expect(audit).to have_attributes(user_id: manager.id, auditable: delivery, outcome: "succeeded")
      expect(audit.metadata).to include("statement_ids" => %w[42 41], "recipient_email" => "mindy@example.com", "target_user_id" => worker.id)
      expect(audit.metadata.to_json).not_to include(token)
    end

    it "sends to a typed address only when it's typed twice the same way" do
      post "/api/v1/pay_stubs/links", params: { user_id: worker.id, statement_ids: [ "42" ], email: "Mindy.Home@Example.com", email_confirmation: "mindy.home@example.co" }, headers: auth(admin)
      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.parsed_body["code"]).to eq("email_mismatch")

      post "/api/v1/pay_stubs/links", params: { user_id: worker.id, statement_ids: [ "42" ], email: "Mindy.Home@Example.com", email_confirmation: "mindy.home@example.com" }, headers: auth(admin)
      expect(response).to have_http_status(:created)
      expect(PayDocumentDelivery.last).to have_attributes(recipient_kind: "typed", recipient_email: "mindy.home@example.com")
      expect(sent_mail.last[:to]).to eq([ "mindy.home@example.com" ])
    end

    it "won't let a manager type an address, so a stub can't be routed to their own inbox" do
      leon = create(:user, :owner, first_name: "Leon", email: "leon@example.com")
      stub_statements(leon, statement_row(70, pay_date: "2026-11-15"))
      post "/api/v1/pay_stubs/links", params: { user_id: leon.id, statement_ids: [ "70" ], email: "roke@example.com", email_confirmation: "roke@example.com" }, headers: auth(manager)

      expect(response).to have_http_status(:forbidden)
      expect(response.parsed_body["code"]).to eq("typed_email_not_allowed")
      expect(PayDocumentDelivery.count).to eq(0)
      expect(sent_mail).to be_empty
      expect(cornerstone_requests).to be_empty
      denial = AuditLog.find_by(action: "pay_documents.link_sent", outcome: "denied")
      expect(denial).to have_attributes(user_id: manager.id)
      expect(denial.metadata).to include("reason" => "typed_email_not_allowed", "target_user_id" => leon.id)

      # The address on file is still fine.
      post "/api/v1/pay_stubs/links", params: { user_id: leon.id, statement_ids: [ "70" ] }, headers: auth(manager)
      expect(response).to have_http_status(:created)
      expect(sent_mail.sole[:to]).to eq([ "leon@example.com" ])
      expect(response.parsed_body.dig("link", "recipient_email")).to eq("l•••@example.com")
    end

    it "accepts only one plain address" do
      [ "a@example.com, b@example.com", "a@example.com;b@example.com", "Mindy <mindy@example.com>", '"m"@example.com', "mindy@localhost", "min dy@example.com" ].each do |address|
        post "/api/v1/pay_stubs/links", params: { user_id: worker.id, statement_ids: [ "42" ], email: address, email_confirmation: address }, headers: auth(admin)
        expect(response.parsed_body["code"]).to eq("invalid_email"), address
      end
      expect(PayDocumentDelivery.count).to eq(0)
      expect(PayDocuments.valid_email?("mindy.home+stubs@example.com")).to be(true)
    end

    it "refuses voided checks and stubs that aren't the worker's" do
      post "/api/v1/pay_stubs/links", params: { user_id: worker.id, statement_ids: %w[42 40] }, headers: auth(admin)
      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.parsed_body["code"]).to eq("statement_voided")

      post "/api/v1/pay_stubs/links", params: { user_id: worker.id, statement_ids: [ "99" ] }, headers: auth(admin)
      expect(response).to have_http_status(:not_found)
      expect(PayDocumentDelivery.count).to eq(0)
      expect(sent_mail).to be_empty
    end

    it "asks for a typed address when there's no email on file" do
      kiosk_worker = create(:user, :kiosk_only)
      stub_statements(kiosk_worker, statement_row(77, pay_date: "2026-11-15"))
      post "/api/v1/pay_stubs/links", params: { user_id: kiosk_worker.id, statement_ids: [ "77" ] }, headers: auth(manager)
      expect(response.parsed_body["code"]).to eq("no_email_on_file")
    end

    it "cancels the link when the email can't be sent" do
      allow(StagingMailTransport).to receive(:deliver).and_raise(StandardError, "provider down")
      post "/api/v1/pay_stubs/links", params: { user_id: worker.id, statement_ids: [ "42" ] }, headers: auth(admin)

      expect(response).to have_http_status(:bad_gateway)
      expect(PayDocumentDelivery.last).to have_attributes(email_status: "failed")
      expect(PayDocumentDelivery.last.state).to eq("failed")
      expect(AuditLog.find_by(action: "pay_documents.link_sent", outcome: "failed")).to be_present
    end

    it "cancels the link when recording the sent email fails, so a retry leaves one working link" do
      calls = 0
      allow(AuditLog).to receive(:record!).and_wrap_original do |original, **args|
        calls += 1 if args[:action] == "pay_documents.link_sent" && args[:outcome] == "succeeded"
        raise ActiveRecord::StatementInvalid, "db hiccup" if args[:action] == "pay_documents.link_sent" && args[:outcome] == "succeeded" && calls == 1

        original.call(**args)
      end
      post "/api/v1/pay_stubs/links", params: { user_id: worker.id, statement_ids: [ "42" ] }, headers: auth(admin)
      expect(response).to have_http_status(:bad_gateway)
      first = PayDocumentDelivery.sole
      expect(first.reload).to have_attributes(email_status: "failed")
      expect(first.state).to eq("failed")

      post "/api/v1/pay_stubs/links", params: { user_id: worker.id, statement_ids: [ "42" ] }, headers: auth(admin)
      expect(response).to have_http_status(:created)
      expect(PayDocumentDelivery.all.select(&:active?).map(&:id)).to eq([ PayDocumentDelivery.last.id ])
    end

    it "limits sends per worker and per sender" do
      10.times do
        post "/api/v1/pay_stubs/links", params: { user_id: worker.id, statement_ids: [ "42" ] }, headers: auth(admin)
        expect(response).to have_http_status(:created)
      end
      post "/api/v1/pay_stubs/links", params: { user_id: worker.id, statement_ids: [ "42" ] }, headers: auth(owner)
      expect(response).to have_http_status(:too_many_requests)
      expect(response.parsed_body["code"]).to eq("rate_limited")

      others = Array.new(5) { create(:user, :employee) }
      others.each { |other| stub_statements(other, statement_row(50 + other.id, pay_date: "2026-11-15")) }
      30.times { |index| create_sent_delivery(sent_by: manager, worker: others[index % 5]) }
      post "/api/v1/pay_stubs/links", params: { user_id: others.first.id, statement_ids: [ (50 + others.first.id).to_s ] }, headers: auth(manager)
      expect(response).to have_http_status(:too_many_requests)
      expect(response.parsed_body["error"]).to include("30 pay stub links in the last hour")
    end
  end

  describe "requests" do
    let!(:open_request) do
      PayDocumentRequest.create!(user: worker, source: "kiosk", scope: "year", year: 2026, recipient_kind: "typed", recipient_email: "mindy.home@example.com")
    end

    it "lists open requests with who, what, when and where" do
      get "/api/v1/pay_stubs/requests", headers: auth(manager)

      expect(response).to have_http_status(:ok)
      row = response.parsed_body.fetch("requests").sole
      expect(row).to include("id" => open_request.id, "scope" => "year", "year" => 2026, "source" => "kiosk",
        "recipient_kind" => "typed", "recipient_email" => "mindy.home@example.com", "status" => "open", "can_send" => false)
      expect(row.dig("worker", "name")).to eq("Mindy Cruz")
      expect(row.dig("worker", "on_file_email")).to eq("m•••@example.com")
      expect(response.parsed_body["open_count"]).to eq(1)

      get "/api/v1/pay_stubs/requests", headers: auth(admin)
      expect(response.parsed_body.fetch("requests").sole).to include("can_send" => true)
    end

    it "won't let a manager fulfil a request made to a typed address, even by sending another one" do
      [ {}, { email: "roke@example.com", email_confirmation: "roke@example.com" } ].each do |override|
        post "/api/v1/pay_stubs/links", params: { user_id: worker.id, request_id: open_request.id, statement_ids: %w[42 41], **override }, headers: auth(manager)

        expect(response).to have_http_status(:forbidden)
        expect(response.parsed_body["code"]).to eq("typed_request_needs_admin")
      end
      expect(open_request.reload).to be_open
      expect(PayDocumentDelivery.count).to eq(0)
      expect(sent_mail).to be_empty
      expect(AuditLog.where(action: "pay_documents.link_sent", outcome: "denied").map { |row| row.metadata["reason"] }).to eq(%w[typed_request_needs_admin] * 2)
    end

    it "lets an admin fulfil a typed request, always to the address from the request" do
      post "/api/v1/pay_stubs/links", params: {
        user_id: worker.id, request_id: open_request.id, statement_ids: %w[42 41],
        email: "someone.else@example.com", email_confirmation: "someone.else@example.com"
      }, headers: auth(admin)

      expect(response).to have_http_status(:created)
      expect(open_request.reload).to have_attributes(status: "fulfilled", resolved_by_id: admin.id)
      expect(PayDocumentDelivery.last).to have_attributes(pay_document_request_id: open_request.id, recipient_kind: "typed", recipient_email: "mindy.home@example.com")
      expect(sent_mail.sole[:to]).to eq([ "mindy.home@example.com" ])

      post "/api/v1/pay_stubs/links", params: { user_id: worker.id, request_id: open_request.id, statement_ids: [ "42" ] }, headers: auth(admin)
      expect(response).to have_http_status(:conflict)
    end

    it "lets a manager fulfil a request for the email on file" do
      on_file_request = PayDocumentRequest.create!(user: worker, source: "kiosk", scope: "pay_date", document_reference: "42",
        document_date: Date.new(2026, 11, 15), recipient_kind: "on_file")
      post "/api/v1/pay_stubs/links", params: { user_id: worker.id, request_id: on_file_request.id, statement_ids: [ "42" ] }, headers: auth(manager)

      expect(response).to have_http_status(:created)
      expect(on_file_request.reload).to have_attributes(status: "fulfilled", resolved_by_id: manager.id)
      expect(sent_mail.sole[:to]).to eq([ "mindy@example.com" ])
    end

    it "won't fulfil a request with another person's stubs" do
      other = create(:user, :employee)
      stub_statements(other, statement_row(88, pay_date: "2026-11-15"))
      post "/api/v1/pay_stubs/links", params: { user_id: other.id, request_id: open_request.id, statement_ids: [ "88" ] }, headers: auth(admin)
      expect(response.parsed_body["code"]).to eq("request_mismatch")
      expect(open_request.reload).to be_open
    end

    it "dismisses a request and audits it" do
      post "/api/v1/pay_stubs/requests/#{open_request.id}/dismiss", params: { note: "Handed over a printed copy" }, headers: auth(manager)

      expect(response).to have_http_status(:ok)
      expect(open_request.reload).to have_attributes(status: "dismissed", resolution_note: "Handed over a printed copy", resolved_by_id: manager.id)
      expect(AuditLog.find_by(action: "pay_documents.request_dismissed", user: manager)).to be_present

      get "/api/v1/pay_stubs/requests", params: { status: "closed" }, headers: auth(manager)
      expect(response.parsed_body["requests"].map { |row| row["id"] }).to eq([ open_request.id ])
    end
  end

  describe "revoking" do
    it "turns a link off and audits who did it" do
      delivery = create_sent_delivery(sent_by: admin, worker: worker)
      post "/api/v1/pay_stubs/links/#{delivery.id}/revoke", headers: auth(manager)

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body.dig("link", "state")).to eq("revoked")
      expect(delivery.reload).to have_attributes(revoked_by_id: manager.id)
      expect(AuditLog.find_by(action: "pay_documents.link_revoked", user: manager, auditable: delivery)).to be_present

      post "/api/v1/pay_stubs/links/#{delivery.id}/revoke", headers: auth(employee)
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "request notification recipients" do
    it "is empty by default and only owners and admins can change it" do
      get "/api/v1/pay_stubs/notification_emails", headers: auth(manager)
      expect(response.parsed_body).to eq("emails" => [], "editable" => false)

      patch "/api/v1/pay_stubs/notification_emails", params: { emails: "office@example.com" }, headers: auth(manager)
      expect(response).to have_http_status(:forbidden)

      patch "/api/v1/pay_stubs/notification_emails", params: { emails: "office@example.com, Chels@Example.com" }, headers: auth(admin)
      expect(response.parsed_body["emails"]).to eq(%w[office@example.com chels@example.com])
      expect(PayDocuments.request_notice_emails).to eq(%w[office@example.com chels@example.com])

      patch "/api/v1/pay_stubs/notification_emails", params: { emails: "not-an-email" }, headers: auth(admin)
      expect(response.parsed_body["code"]).to eq("invalid_email")
    end
  end

  describe "terminating a worker" do
    it "revokes their working links and closes their open requests, with an audit row each" do
      live = create_sent_delivery(sent_by: manager, worker: worker)
      expired = create_sent_delivery(sent_by: manager, worker: worker).tap { |delivery| delivery.update!(expires_at: 1.day.ago) }
      request = PayDocumentRequest.create!(user: worker, source: "kiosk", scope: "latest", recipient_kind: "on_file")

      post "/api/v1/admin/users/#{worker.id}/terminate", params: { effective_on: "2026-11-10" }, headers: auth(admin)

      expect(response).to have_http_status(:ok)
      expect(live.reload).to have_attributes(revoked_by_id: admin.id)
      expect(expired.reload.revoked_at).to be_nil
      expect(request.reload).to have_attributes(status: "dismissed", resolved_by_id: admin.id)
      revoked = AuditLog.find_by(action: "pay_documents.link_revoked", auditable: live)
      expect(revoked).to have_attributes(user_id: admin.id)
      expect(revoked.metadata).to include("reason" => "employee_terminated")
      expect(AuditLog.find_by(action: "pay_documents.request_dismissed", auditable: request).metadata).to include("reason" => "employee_terminated")
    end
  end

  def create_sent_delivery(sent_by:, worker:)
    PayDocumentDelivery.create!(user: worker, sent_by: sent_by, origin: "sender", recipient_email: "x@example.com", recipient_kind: "typed",
      token_digest: PayDocumentDelivery.digest(PayDocumentDelivery.generate_token), expires_at: 7.days.from_now,
      max_downloads_per_document: 5, email_status: "sent").tap do |delivery|
      delivery.pay_document_items.create!(kind: "pay_statement", reference: "42", document_date: Date.new(2026, 11, 15))
    end
  end
end
