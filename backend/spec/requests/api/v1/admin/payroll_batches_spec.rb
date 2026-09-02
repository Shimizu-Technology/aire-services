# frozen_string_literal: true

require "rails_helper"
require "csv"

RSpec.describe "Api::V1::Admin::PayrollBatches", type: :request do
  include ActiveSupport::Testing::TimeHelpers

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

  it "keeps non-blocking exclusions finalizable in both preview and create" do
    included = create_entry
    pending = create_entry(approval_status: "pending")

    post "/api/v1/admin/payroll_batches/preview",
         params: { start_date: "2026-08-01", end_date: "2026-08-15" },
         headers: admin_headers
    expect(response).to have_http_status(:ok)
    expect(json).to include(can_finalize: true)

    post "/api/v1/admin/payroll_batches",
         params: { start_date: "2026-08-01", end_date: "2026-08-15" },
         headers: admin_headers
    expect(response).to have_http_status(:created)
    expect(PayrollBatchEntry.where(source_time_entry_id: included.id)).to exist
    expect(PayrollBatchExclusion.where(source_time_entry_id: pending.id, reason: "pending_approval")).to exist
  end

  it "blocks missing categories consistently in preview and finalization" do
    entry = create_entry
    entry.update_columns(time_category_id: nil)

    post "/api/v1/admin/payroll_batches/preview",
         params: { start_date: "2026-08-01", end_date: "2026-08-15" },
         headers: admin_headers
    expect(response).to have_http_status(:ok)
    expect(json).to include(can_finalize: false)
    expect(json.dig(:issues, :missing_category_count)).to eq(1)

    post "/api/v1/admin/payroll_batches",
         params: { start_date: "2026-08-01", end_date: "2026-08-15" },
         headers: admin_headers
    expect(response).to have_http_status(:unprocessable_entity)
    expect(json.fetch(:error)).to match(/missing work categories/i)
  end

  it "recreates and records a manually processed historical snapshot while preserving late approvals" do
    guam = ActiveSupport::TimeZone[TimeClockService::BUSINESS_TIMEZONE]
    included = create_entry
    included.update_columns(time_category_id: nil, created_at: guam.local(2026, 8, 15, 12), approved_at: guam.local(2026, 8, 30, 12))
    late = create_entry
    late.update_columns(created_at: guam.local(2026, 8, 15, 12), approved_at: guam.local(2026, 8, 31, 13, 7))
    cutoff_at = guam.local(2026, 8, 31, 13, 6).iso8601
    processed_at = guam.local(2026, 8, 31, 13, 18, 5).iso8601

    travel_to(guam.local(2026, 9, 2, 12)) do
      post "/api/v1/admin/payroll_batches/preview",
           params: { start_date: "2026-08-01", end_date: "2026-08-15", cutoff_at: cutoff_at },
           headers: admin_headers

      expect(response).to have_http_status(:ok)
      expect(json.dig(:summary, :total_hours)).to eq(8.0)
      expect(json.dig(:issues, :missing_category_count)).to eq(1)
      expect(json.dig(:issues, :pending_approval_count)).to eq(1)

      expect do
        post "/api/v1/admin/payroll_batches",
             params: {
               start_date: "2026-08-01",
               end_date: "2026-08-15",
               manual_processing: true,
               cutoff_at: cutoff_at,
               processed_at: processed_at,
               external_pay_period_id: "61",
               processing_note: "Matched against the committed Cornerstone payroll",
               acknowledge_missing_categories: true
             },
             headers: admin_headers
      end.to change(PayrollBatchProcessingEvent, :count).by(1)
        .and change { AuditLog.where(action: "payroll_batch.manually_processed").count }.by(1)
    end

    expect(response).to have_http_status(:created)
    expect(json.dig(:summary, :total_hours)).to eq(8.0)
    expect(json.dig(:processing, :status)).to eq("committed")
    expect(json.dig(:processing, :external_system)).to eq("cornerstone_payroll_manual")
    expect(json.dig(:processing, :external_pay_period_id)).to eq("61")
    expect(PayrollBatchEntry.where(source_time_entry_id: included.id)).to exist
    expect(PayrollBatchExclusion.where(source_time_entry_id: late.id, reason: "approved_after_cutoff")).to exist
  end

  it "requires an explicit legacy-category acknowledgement for manual reconciliation" do
    guam = ActiveSupport::TimeZone[TimeClockService::BUSINESS_TIMEZONE]
    entry = create_entry
    entry.update_columns(time_category_id: nil, created_at: guam.local(2026, 8, 15, 12))

    travel_to(guam.local(2026, 9, 2, 12)) do
      post "/api/v1/admin/payroll_batches",
           params: {
             start_date: "2026-08-01",
             end_date: "2026-08-15",
             manual_processing: true,
             cutoff_at: guam.local(2026, 8, 31, 13, 6).iso8601,
             processed_at: guam.local(2026, 8, 31, 13, 18).iso8601,
             external_pay_period_id: "61",
             processing_note: "Matched against the committed Cornerstone payroll"
           },
           headers: admin_headers
    end

    expect(response).to have_http_status(:unprocessable_entity)
    expect(json.fetch(:error)).to match(/missing work categories/i)
    expect(PayrollBatch.count).to eq(0)
    expect(PayrollBatchProcessingEvent.count).to eq(0)
  end

  it "rejects every invalid manual reconciliation timestamp and note combination without persisting" do
    guam = ActiveSupport::TimeZone[TimeClockService::BUSINESS_TIMEZONE]
    create_entry
    valid_cutoff = guam.local(2026, 8, 31, 13, 6)
    valid_processed_at = guam.local(2026, 8, 31, 13, 18)
    base_params = {
      start_date: "2026-08-01",
      end_date: "2026-08-15",
      manual_processing: true,
      cutoff_at: valid_cutoff.iso8601,
      processed_at: valid_processed_at.iso8601,
      external_pay_period_id: "61",
      processing_note: "Matched against the committed Cornerstone payroll"
    }
    invalid_overrides = [
      { cutoff_at: guam.local(2026, 9, 2, 12, 1).iso8601 },
      { processed_at: guam.local(2026, 8, 31, 13, 5).iso8601 },
      { processed_at: guam.local(2026, 9, 2, 12, 1).iso8601 },
      { external_pay_period_id: "" },
      { processing_note: "too short" }
    ]

    travel_to(guam.local(2026, 9, 2, 12)) do
      invalid_overrides.each do |overrides|
        batch_count = PayrollBatch.count
        event_count = PayrollBatchProcessingEvent.count
        post "/api/v1/admin/payroll_batches",
             params: base_params.merge(overrides),
             headers: admin_headers
        expect(response).to have_http_status(:unprocessable_entity)
        expect(json.fetch(:error)).to be_present
        expect(PayrollBatch.count).to eq(batch_count)
        expect(PayrollBatchProcessingEvent.count).to eq(event_count)
      end
    end
  end

  it "flags negative adjustments and finalizes them only with acknowledgement" do
    entry = create_entry
    post "/api/v1/admin/payroll_batches",
         params: { start_date: "2026-08-01", end_date: "2026-08-15" },
         headers: admin_headers
    expect(response).to have_http_status(:created)

    entry.update!(end_time: entry.end_time - 2.hours)
    post "/api/v1/admin/payroll_batches/preview",
         params: { start_date: "2026-08-16", end_date: "2026-08-31" },
         headers: admin_headers
    expect(response).to have_http_status(:ok)
    expect(json).to include(can_finalize: true, requires_negative_adjustment_acknowledgement: true)

    post "/api/v1/admin/payroll_batches",
         params: { start_date: "2026-08-16", end_date: "2026-08-31" },
         headers: admin_headers
    expect(response).to have_http_status(:unprocessable_entity)
    expect(json.fetch(:error)).to match(/negative payroll corrections/i)

    post "/api/v1/admin/payroll_batches",
         params: {
           start_date: "2026-08-16",
           end_date: "2026-08-31",
           acknowledge_negative_adjustments: true,
           negative_adjustment_note: "Corrected an overstated clock-out"
         },
         headers: admin_headers
    expect(response).to have_http_status(:created)
  end

  it "finalizes, lists, shows, and exports an immutable payroll batch" do
    entry = create_entry

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
    csv = CSV.parse(response.body)
    expected_header = [
      "Batch ID", "Period start", "Period end", "Cutoff at", "Employee", "Email",
      "Source entry", "Type", "Original work date", "Category", "Regular hours",
      "Overtime hours", "Total hours"
    ]
    batch = PayrollBatch.find_by!(public_id: batch_id)
    expect(csv).to eq([
      expected_header,
      [
        batch_id, "2026-08-01", "2026-08-15", batch.cutoff_at.iso8601,
        "Alice Pilot", employee.email, entry.id.to_s, "current", "2026-08-15",
        category.name, "8.0", "0.0", "8.0"
      ]
    ])
    expect(csv.first).not_to include("effective_rate_cents")
    expect(csv.drop(1)).to all(satisfy { |row| row.length == expected_header.length })
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

  it "shows excluded time moving from approval to the next payroll and Cornerstone" do
    pending = create_entry(approval_status: "pending")
    post "/api/v1/admin/payroll_batches",
         params: { start_date: "2026-08-01", end_date: "2026-08-15" },
         headers: admin_headers
    expect(response).to have_http_status(:created)

    get "/api/v1/admin/payroll_batches/carryovers", headers: admin_headers
    expect(response).to have_http_status(:ok)
    expect(json.dig(:items, 0)).to include(source_time_entry_id: pending.id.to_s, status: "awaiting_approval")

    pending.update!(approval_status: "approved", approved_at: Time.current)
    get "/api/v1/admin/payroll_batches/carryovers", headers: admin_headers
    expect(json.dig(:items, 0, :status)).to eq("ready_for_next_batch")

    post "/api/v1/admin/payroll_batches",
         params: { start_date: "2026-08-16", end_date: "2026-08-31" },
         headers: admin_headers
    later_batch_id = json.fetch(:id)

    get "/api/v1/admin/payroll_batches/carryovers", headers: admin_headers
    expect(json.dig(:items, 0)).to include(status: "awaiting_cornerstone")
    expect(json.dig(:items, 0, :included_batch, :id)).to eq(later_batch_id)

    PayrollBatchProcessingEvent.create!(
      payroll_batch: PayrollBatch.find_by!(public_id: later_batch_id),
      event_id: "cornerstone-import-9",
      status: "imported",
      external_system: "cornerstone_payroll",
      external_pay_period_id: "9",
      occurred_at: Time.current
    )
    get "/api/v1/admin/payroll_batches/carryovers", headers: admin_headers
    expect(json.dig(:items, 0, :status)).to eq("imported")
  end

  it "reports summary totals from the complete carryover queue when displayed items are truncated" do
    stub_const("Payroll::CarryoverQueue::MAX_ITEMS", 2)
    3.times { create_entry(approval_status: "pending") }
    post "/api/v1/admin/payroll_batches",
         params: { start_date: "2026-08-01", end_date: "2026-08-15" },
         headers: admin_headers
    expect(response).to have_http_status(:created)

    get "/api/v1/admin/payroll_batches/carryovers", headers: admin_headers

    expect(response).to have_http_status(:ok)
    expect(json.fetch(:items).length).to eq(2)
    expect(json.fetch(:summary)).to include(awaiting_approval_count: 3)
    expect(json.fetch(:truncated)).to be(true)
  end
end
