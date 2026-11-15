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

  context "when payroll is unavailable" do
    let(:cornerstone_down) { true }

    it "shows a recoverable error rather than an incomplete list" do
      read_period(admin)
      expect(response).to have_http_status(:service_unavailable)
      expect(response.parsed_body["code"]).to eq("payroll_unavailable")
    end
  end
end
