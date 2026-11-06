# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Paused payroll integration", type: :request do
  around do |example|
    previous = ENV["CONNECTED_PAYROLL_MODE"]
    ENV["CONNECTED_PAYROLL_MODE"] = "paused"
    example.run
  ensure
    ENV["CONNECTED_PAYROLL_MODE"] = previous
  end

  it "holds calendar publication before any partial state is created" do
    expect(Payroll::CalendarPeriodPublisher).not_to receive(:new)
    expect { put "/api/v1/payroll/calendar_periods/123", params: {}, as: :json }.not_to change(PayrollCalendarPeriod, :count)
    expect(response).to have_http_status(:service_unavailable)
    expect(response.headers["Retry-After"]).to eq("60")
    expect(response.parsed_body.fetch("connected_payroll")).to include("mode" => "paused", "enabled" => false)
  end

  it "does not classify paused cockpit service availability as an authentication failure" do
    expect do
      get "/api/v1/payroll/cockpit/periods/123"
    end.not_to change { AuditLog.where(action: "payroll_cockpit.authorization_denied").count }
    expect(response).to have_http_status(:service_unavailable)
    expect(response.headers["Retry-After"]).to eq("60")
  end
  def payroll_write_counts
    [ PayrollBatch, PayrollBatchEntry, PayrollBatchExclusion, PayrollBatchProcessingEvent,
      PayrollEntryProcessingEvent, PayrollOutboxEvent, PayrollCalendarPeriod, PayrollCalendarPeriodRevision, AuditLog ].map(&:count)
  end

  it "refuses admin manual processing and finalization before constructing a service or writing any ledger or audit rows" do
    admin = create(:user, :admin)
    headers = { "Authorization" => "Bearer test_token_#{admin.id}" }
    expect(Payroll::BatchFinalizer).not_to receive(:new)
    [ false, true ].each do |manual|
      expect do
        post "/api/v1/admin/payroll_batches", params: { start_date: "2026-10-16", end_date: "2026-10-31", manual_processing: manual }, headers: headers
      end.not_to change { payroll_write_counts }
      expect(response).to have_http_status(:service_unavailable)
      expect(response.parsed_body).to include("error" => ConnectedPayrollMode::MESSAGE,
        "connected_payroll" => { "mode" => "paused", "enabled" => false, "message" => ConnectedPayrollMode::MESSAGE })
      expect(response.headers["Retry-After"]).to eq("60")
    end
  end

  it "refuses publication receipts and connected period locks without writing any rows" do
    expect(Payroll::CalendarPeriodPublisher).not_to receive(:new)
    expect(Payroll::ScheduledCutoffFinalizer).not_to receive(:new)
    expect(Payroll::ManualCalendarFinalizer).not_to receive(:new)
    expect { put "/api/v1/payroll/calendar_periods/123", params: {}, as: :json }.not_to change { payroll_write_counts }
    expect(response).to have_http_status(:service_unavailable)
    expect(response.parsed_body.fetch("error")).to eq(ConnectedPayrollMode::MESSAGE)
    expect { post "/api/v1/payroll/cockpit/periods/123/finalize", params: {}, as: :json }.not_to change { payroll_write_counts }
    expect(response).to have_http_status(:service_unavailable)
    expect(response.parsed_body.fetch("error")).to eq(ConnectedPayrollMode::MESSAGE)
  end

  it "keeps authenticated history and read-only previews available with explicit paused capability" do
    admin = create(:user, :admin)
    headers = { "Authorization" => "Bearer test_token_#{admin.id}" }
    get "/api/v1/admin/payroll_batches", headers: headers
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body.dig("connected_payroll", "enabled")).to be(false)
    expect do
      post "/api/v1/admin/payroll_batches/preview", params: { start_date: "2026-10-16", end_date: "2026-10-31" }, headers: headers
    end.not_to change(PayrollBatch, :count)
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).to include("can_finalize" => false, "finalization_blocked_reason" => ConnectedPayrollMode::MESSAGE)
    get "/api/v1/payroll_cutoff", headers: headers
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body.fetch("connected_payroll")).to include("mode" => "paused", "enabled" => false)
    expect(response.parsed_body.dig("cutoff", "period")).to be_nil
  end

  it "blocks direct connected-period batch finalization before source locks or any writes" do
    period = create(:payroll_calendar_period)
    service = Payroll::BatchFinalizer.new(start_date: period.start_date, end_date: period.end_date, actor: nil, calendar_period: period)
    before = period.attributes.deep_dup
    counts = payroll_write_counts
    expect { service.call }.to raise_error(ConnectedPayrollMode::Paused, ConnectedPayrollMode::MESSAGE)
    expect(payroll_write_counts).to eq(counts)
    expect(period.reload.attributes).to eq(before)
  end
  it "keeps ordinary time review, approvals, hours reports and CSV exports working while paused" do
    admin = create(:user, :admin)
    employee = create(:user, :employee)
    category = create(:time_category)
    employee.assigned_time_categories << category
    entry = create(:time_entry, user: employee, time_category: category, work_date: Date.new(2026, 11, 1),
      status: "completed", entry_method: "clock", clock_source: "legacy", approval_status: "pending", overtime_status: "none")
    headers = { "Authorization" => "Bearer test_token_#{admin.id}" }
    get "/api/v1/time_entries", headers: headers
    expect(response).to have_http_status(:ok)
    post "/api/v1/time_entries/#{entry.id}/approve", headers: headers
    expect(response).to have_http_status(:ok)
    expect(entry.reload.approval_status).to eq("approved")
    dates = { start_date: "2026-11-01", end_date: "2026-11-15" }
    get "/api/v1/admin/hours_report", params: dates, headers: headers
    expect(response).to have_http_status(:ok)
    get "/api/v1/admin/hours_report/summary_csv", params: dates.merge(acknowledge_draft: true), headers: headers
    expect(response).to have_http_status(:ok)
    expect(response.media_type).to eq("text/csv")
    expect(PayrollBatch.count).to eq(0)
    expect(PayrollOutboxEvent.count).to eq(0)
  end
end
