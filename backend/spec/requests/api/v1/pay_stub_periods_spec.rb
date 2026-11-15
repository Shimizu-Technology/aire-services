# frozen_string_literal: true

require "rails_helper"
require_relative "../../../support/fake_worker_statements"

RSpec.describe "Period pay stubs", type: :request do
  include_context "fake worker statements"
  include ActiveSupport::Testing::TimeHelpers

  let(:admin) { create(:user, :admin) }
  let(:manager) { create(:user, :manager) }
  let(:worker) { create(:user, :employee) }
  let(:period) { create(:payroll_calendar_period, start_date: "2026-10-16", end_date: "2026-10-31", pay_date: Date.new(2026, 11, 10)) }

  def read_period(actor, start = period.start_date)
    get "/api/v1/pay_stubs/periods/#{start}", headers: { "Authorization" => "Bearer test_token_#{actor.id}" }
  end

  before do
    travel_to Time.zone.parse("2026-11-15 12:00")
    batch = create(:payroll_batch, start_date: period.start_date, end_date: period.end_date)
    period.update_columns(payroll_batch_id: batch.id)
    batch.payroll_batch_entries.create!(source_time_entry_id: 1, source_user_id: worker.id, work_date: period.start_date,
      week_start: period.start_date.beginning_of_week, source_kind: "current", line_key: "base")
    stub_statements(worker,
      statement_row(42, pay_date: "2026-11-10", period_start: "2026-10-16", period_end: "2026-10-31"),
      statement_row(43, pay_date: "2026-11-11", period_start: "2026-10-16", period_end: "2026-10-31"),
      statement_row(45, pay_date: "2026-11-10", status: "prepared", period_start: "2026-10-16", period_end: "2026-10-31"),
      statement_row(44, pay_date: "2026-11-10", status: "voided", period_start: "2026-10-16", period_end: "2026-10-31"),
      statement_row(41, pay_date: "2026-10-31"))
  end

  after { travel_back }

  it "lists only issued stubs for the exact period, includes missing emails, and masks manager data" do
    worker.update!(email: "missing@placeholder.local")
    read_period(manager)
    expect(response).to have_http_status(:ok)
    rows = response.parsed_body.fetch("workers")
    expect(rows.size).to eq(1)
    expect(rows.first.dig("worker", "on_file_email")).to be_nil
    expect(rows.first.fetch("statements").map { |row| row.fetch("id") }).to eq(%w[43 42])
    expect(rows.first.fetch("statements").first.keys).to contain_exactly("id", "pay_date", "period_start", "period_end", "voided")
    expect_no_pay_details(response.body)
  end

  it "retains old period history beyond the global fifty-link window, without including other periods" do
    result = PayDocuments::LinkSender.send!(worker: worker, actor: admin, statement_ids: [ "42" ])
    51.times do |index|
      PayDocumentDelivery.create!(user: worker, sent_by: admin, origin: "sender", recipient_email: worker.email,
        recipient_kind: "on_file", token_digest: "other-#{index}", expires_at: 7.days.from_now, email_status: "sent", max_downloads_per_document: 5)
    end
    read_period(manager)
    expect(response).to have_http_status(:ok)
    links = response.parsed_body.fetch("workers").sole.fetch("links")
    expect(links.map { |link| link["id"] }).to eq([ result.delivery.id ])
    expect_no_pay_details(response.body)
    expect(response.body).not_to include(worker.email)
  end

  it "allows admins and refuses employees" do
    read_period(admin)
    expect(response).to have_http_status(:ok)
    read_period(worker)
    expect(response).to have_http_status(:forbidden)
  end

  it "rejects invalid and unpublished periods" do
    read_period(admin, "bad")
    expect(response).to have_http_status(:unprocessable_entity)
    read_period(admin, "2020-01-01")
    expect(response).to have_http_status(:not_found)
  end

  it "does not load stubs before payday" do
    period
    travel_to Time.zone.parse("2026-11-05 12:00")
    read_period(admin)
    expect(response).to have_http_status(:unprocessable_entity)
    expect(cornerstone_requests).to be_empty
  end

  it "includes a departed batch member but still refuses sending to them" do
    worker.update!(is_active: false, terminated_at: Time.current, termination_effective_on: period.end_date)
    read_period(admin)
    expect(response.parsed_body.fetch("workers").sole.fetch("inactive")).to be(true)
    post "/api/v1/pay_stubs/links", params: { user_id: worker.id, statement_ids: [ "42" ] },
      headers: { "Authorization" => "Bearer test_token_#{admin.id}" }
    expect(response).to have_http_status(:not_found)
    expect(sent_mail).to be_empty
  end

  it "does not look up staff outside the period batch" do
    other = create(:user, :employee)
    stub_statements(other, statement_row(99, pay_date: "2026-11-10", period_start: "2026-10-16", period_end: "2026-10-31"))
    read_period(admin)
    expect(response.parsed_body.fetch("workers").map { |row| row.dig("worker", "id") }).to eq([ worker.id ])
    expect(cornerstone_requests.size).to eq(1)
  end

  it "returns open request references and closes a matching request when the step sends" do
    request = PayDocumentRequest.create!(user: worker, source: "kiosk", document_kind: "pay_statement",
      scope: "pay_date", document_reference: "42", recipient_kind: "on_file")
    read_period(admin)
    open_request = response.parsed_body.fetch("workers").sole.fetch("open_requests").sole
    expect(open_request).to include("id" => request.id, "statement_id" => "42", "scope" => "pay_date")
    post "/api/v1/pay_stubs/links", params: { user_id: worker.id, statement_ids: [ "42" ], request_id: open_request.fetch("id") },
      headers: { "Authorization" => "Bearer test_token_#{admin.id}" }
    expect(response).to have_http_status(:created)
    expect(request.reload.status).to eq("fulfilled")
    get "/api/v1/pay_stubs/requests", headers: { "Authorization" => "Bearer test_token_#{manager.id}" }
    expect(response.parsed_body.fetch("requests")).to be_empty
  end

  it "resolves latest requests to the actual latest reference without adding another payroll lookup" do
    PayDocumentRequest.create!(user: worker, source: "kiosk", document_kind: "pay_statement", scope: "latest", recipient_kind: "on_file")
    read_period(admin)
    expect(response.parsed_body.fetch("workers").sole.fetch("open_requests").sole.fetch("statement_id")).to eq("43")
    expect(cornerstone_requests.size).to eq(1)
  end

  it "keeps successful rows when another person's lookup times out" do
    other = create(:user, :employee)
    batch = period.reload.payroll_batch
    batch.payroll_batch_entries.create!(source_time_entry_id: 2, source_user_id: other.id, work_date: period.start_date,
      week_start: period.start_date.beginning_of_week, source_kind: "current", line_key: "base")
    allow(Payroll::WorkerStatementsClient).to receive(:new).and_wrap_original do |original, **|
      client = original.call(env: cornerstone_env, http: method(:fake_cornerstone))
      allow(client).to receive(:statements).and_call_original
      allow(client).to receive(:statements).with(other.payroll_integration_uuid).and_raise(Payroll::WorkerStatementsClient::Unavailable)
      client
    end
    read_period(admin)
    expect(response).to have_http_status(:ok)
    rows = response.parsed_body.fetch("workers").index_by { |row| row.dig("worker", "id") }
    expect(rows.fetch(worker.id).fetch("lookup_failed")).to be(false)
    expect(rows.fetch(other.id).fetch("lookup_failed")).to be(true)
  end

  it "leaves out a paid person who isn't connected to payroll instead of offering a retry" do
    other = create(:user, :employee)
    batch = period.reload.payroll_batch
    batch.payroll_batch_entries.create!(source_time_entry_id: 2, source_user_id: other.id, work_date: period.start_date,
      week_start: period.start_date.beginning_of_week, source_kind: "current", line_key: "base")
    allow(Payroll::WorkerStatementsClient).to receive(:new).and_wrap_original do |original, **|
      client = original.call(env: cornerstone_env, http: method(:fake_cornerstone))
      allow(client).to receive(:statements).and_call_original
      allow(client).to receive(:statements).with(other.payroll_integration_uuid).and_raise(Payroll::WorkerStatementsClient::NotLinked)
      client
    end
    read_period(admin)
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body.fetch("workers").map { |row| row.dig("worker", "id") }).to eq([ worker.id ])
  end

  context "when payroll is unavailable" do
    let(:cornerstone_down) { true }

    it "keeps the person visible with a retry when their lookup fails" do
      read_period(admin)
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body.fetch("workers").sole.fetch("lookup_failed")).to be(true)
    end
  end
end
