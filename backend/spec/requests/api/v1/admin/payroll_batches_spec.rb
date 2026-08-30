# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Api::V1::Admin::PayrollBatches", type: :request do
  let(:admin) { create(:user, :admin) }
  let(:employee) { create(:user, :employee, first_name: "Alice", last_name: "Pilot") }
  let(:category) { create(:time_category, hourly_rate_cents: 3_200) }
  let(:admin_headers) { { "Authorization" => "Bearer test_token_#{admin.id}" } }
  let(:employee_headers) { { "Authorization" => "Bearer test_token_#{employee.id}" } }

  def json
    JSON.parse(response.body, symbolize_names: true)
  end

  def create_entry(approval_status: nil)
    date = Date.new(2026, 8, 15)
    guam = ActiveSupport::TimeZone[TimeClockService::BUSINESS_TIMEZONE]
    create(
      :time_entry,
      user: employee,
      time_category: category,
      work_date: date,
      start_time: guam.local(2026, 8, 15, 8),
      end_time: guam.local(2026, 8, 15, 16),
      hours: 8,
      status: "completed",
      approval_status: approval_status,
      overtime_status: "none"
    )
  end

  it "previews inclusions and unresolved work without creating a batch" do
    create_entry
    create_entry(approval_status: "pending")

    post "/api/v1/admin/payroll_batches/preview",
         params: { start_date: "2026-08-01", end_date: "2026-08-15" },
         headers: admin_headers

    expect(response).to have_http_status(:ok)
    expect(json).to include(preview: true, can_finalize: true)
    expect(json.dig(:summary, :total_hours)).to eq(8.0)
    expect(json.dig(:summary, :exclusion_count)).to eq(1)
    expect(json.dig(:issues, :pending_approval_count)).to eq(1)
    expect(PayrollBatch.count).to eq(0)
  end

  it "finalizes, lists, shows, and exports an immutable payroll batch" do
    create_entry

    post "/api/v1/admin/payroll_batches",
         params: { start_date: "2026-08-01", end_date: "2026-08-15" },
         headers: admin_headers

    expect(response).to have_http_status(:created)
    batch_id = json.fetch(:id)
    checksum = json.fetch(:checksum)
    expect(json.dig(:payload, :export)).to include(batch_id: batch_id, checksum: checksum, readiness_status: "finalized")

    get "/api/v1/admin/payroll_batches", headers: admin_headers
    expect(response).to have_http_status(:ok)
    expect(json.dig(:payroll_batches, 0, :id)).to eq(batch_id)
    expect(json).to include(total_count: 1, truncated: false)

    get "/api/v1/admin/payroll_batches/#{batch_id}", headers: admin_headers
    expect(response).to have_http_status(:ok)
    expect(json.fetch(:checksum)).to eq(checksum)

    expect do
      get "/api/v1/admin/payroll_batches/#{batch_id}/export", headers: admin_headers
    end.to change { AuditLog.where(action: "payroll_batch.exported").count }.by(1)
    expect(response).to have_http_status(:ok)
    expect(response.media_type).to eq("text/csv")
    expect(response.body).to include(batch_id, "Alice Pilot")
  end

  it "rejects non-admin access and invalid date ranges" do
    post "/api/v1/admin/payroll_batches/preview",
         params: { start_date: "2026-08-01", end_date: "2026-08-15" },
         headers: employee_headers
    expect(response).to have_http_status(:forbidden)

    post "/api/v1/admin/payroll_batches/preview",
         params: { start_date: "not-a-date", end_date: "2026-08-15" },
         headers: admin_headers
    expect(response).to have_http_status(:unprocessable_entity)
    expect(json.fetch(:error)).to match(/valid ISO 8601 date/)

    post "/api/v1/admin/payroll_batches",
         params: { start_date: "not-a-date", end_date: "2026-08-15" },
         headers: admin_headers
    expect(response).to have_http_status(:unprocessable_entity)
    expect(json.fetch(:error)).to match(/valid ISO 8601 date/)
  end

  it "rejects non-admin access to every payroll batch action" do
    create_entry
    post "/api/v1/admin/payroll_batches",
         params: { start_date: "2026-08-01", end_date: "2026-08-15" },
         headers: admin_headers
    batch_id = json.fetch(:id)

    get "/api/v1/admin/payroll_batches", headers: employee_headers
    expect(response).to have_http_status(:forbidden)

    get "/api/v1/admin/payroll_batches/#{batch_id}", headers: employee_headers
    expect(response).to have_http_status(:forbidden)

    get "/api/v1/admin/payroll_batches/#{batch_id}/export", headers: employee_headers
    expect(response).to have_http_status(:forbidden)

    post "/api/v1/admin/payroll_batches",
         params: { start_date: "2026-08-16", end_date: "2026-08-31" },
         headers: employee_headers
    expect(response).to have_http_status(:forbidden)
  end

  it "signals when the permanent history response is limited to the newest 100 batches" do
    now = Time.current
    PayrollBatch.insert_all!(101.times.map do |index|
      date = Date.new(2020, 1, 1) + index.days
      {
        public_id: "AIRE-HISTORY-#{index}",
        start_date: date,
        end_date: date,
        cutoff_at: now + index.seconds,
        finalized_at: now + index.seconds,
        checksum: Digest::SHA256.hexdigest(index.to_s),
        payload: {},
        summary: { total_hours: 0, employee_count: 0, exclusion_count: 0 },
        issues: {},
        created_at: now,
        updated_at: now
      }
    end)

    get "/api/v1/admin/payroll_batches", headers: admin_headers

    expect(response).to have_http_status(:ok)
    expect(json.fetch(:payroll_batches).length).to eq(100)
    expect(json).to include(total_count: 101, truncated: true)
  end
end
