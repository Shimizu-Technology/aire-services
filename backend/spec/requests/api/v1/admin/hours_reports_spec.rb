# frozen_string_literal: true

require "rails_helper"
require "csv"

RSpec.describe "Api::V1::Admin::HoursReports", type: :request do
  let(:admin) { create(:user, :admin) }
  let(:employee) { create(:user, :employee, first_name: "Alice", last_name: "Pilot", approval_group: "cfi") }
  let(:category) { create(:time_category, name: "Flight Instruction") }

  let(:auth_headers) { { "Authorization" => "Bearer test_token_#{admin.id}" } }

  def json
    JSON.parse(response.body, symbolize_names: true)
  end

  def create_entry(user:, date:, hours:, start_hour: 9)
    guam = ActiveSupport::TimeZone[TimeClockService::BUSINESS_TIMEZONE]
    create(
      :time_entry,
      user: user,
      time_category: category,
      work_date: date,
      start_time: guam.local(date.year, date.month, date.day, start_hour, 0, 0),
      end_time: guam.local(date.year, date.month, date.day, start_hour, 0, 0) + hours.hours,
      hours: hours,
      status: "completed",
      approval_status: nil,
      overtime_status: "none"
    )
  end

  it "calculates weekly overtime using context outside the selected semi-monthly period" do
    # Week of Sunday May 10 through Saturday May 16. The report starts Friday,
    # but OT still depends on Sun-Thu hours from the prior pay period.
    (Date.new(2026, 5, 10)..Date.new(2026, 5, 14)).each do |date|
      create_entry(user: employee, date: date, hours: 8)
    end
    create_entry(user: employee, date: Date.new(2026, 5, 15), hours: 4)
    create_entry(user: employee, date: Date.new(2026, 5, 16), hours: 2)

    get "/api/v1/admin/hours_report",
        params: { start_date: "2026-05-15", end_date: "2026-05-31", approval_group: "cfi" },
        headers: auth_headers

    expect(response).to have_http_status(:ok)
    employee_row = json.fetch(:employees).first
    expect(employee_row.fetch(:total_hours)).to eq(6.0)
    expect(employee_row.fetch(:regular_hours)).to eq(0.0)
    expect(employee_row.fetch(:overtime_hours)).to eq(6.0)
    expect(employee_row.fetch(:weeks).first.fetch(:context_hours)).to eq(40.0)
    expect(employee_row.fetch(:weeks).first.fetch(:context_note)).to match(/outside this filtered report selection/)
  end

  it "calculates OT against all weekly hours even when category filter narrows displayed hours" do
    category_b = create(:time_category, name: "Admin Duties")
    (Date.new(2026, 6, 1)..Date.new(2026, 6, 5)).each do |date|
      create_entry(user: employee, date: date, hours: 8)
    end
    friday_extra = create_entry(user: employee, date: Date.new(2026, 6, 5), hours: 4, start_hour: 18)
    friday_extra.update!(time_category: category_b)

    get "/api/v1/admin/hours_report",
        params: { start_date: "2026-06-01", end_date: "2026-06-15", time_category_id: category_b.id },
        headers: auth_headers

    expect(response).to have_http_status(:ok)
    employee_row = json.fetch(:employees).first
    expect(employee_row.fetch(:total_hours)).to eq(4.0)
    expect(employee_row.fetch(:regular_hours)).to eq(0.0)
    expect(employee_row.fetch(:overtime_hours)).to eq(4.0)
    expect(employee_row.fetch(:weeks).first.fetch(:weekly_total_hours)).to eq(44.0)
    expect(employee_row.fetch(:weeks).first.fetch(:context_hours)).to eq(40.0)
  end

  it "filters reports by department" do
    other_employee = create(:user, :employee, first_name: "Bob", last_name: "Ops", approval_group: "ops_maintenance")
    create_entry(user: employee, date: Date.new(2026, 5, 4), hours: 5)
    create_entry(user: other_employee, date: Date.new(2026, 5, 4), hours: 7)

    get "/api/v1/admin/hours_report",
        params: { start_date: "2026-05-01", end_date: "2026-05-15", approval_group: "ops_maintenance" },
        headers: auth_headers

    expect(response).to have_http_status(:ok)
    expect(json.fetch(:employees).map { |row| row.fetch(:full_name) }).to eq([ "Bob Ops" ])
    expect(json.dig(:summary, :total_hours)).to eq(7.0)
  end

  it "returns exact reconciled two-decimal category and source breakdowns" do
    entry = create_entry(user: employee, date: Date.new(2026, 5, 4), hours: 11.95)
    entry.update!(clock_source: "mobile")

    get "/api/v1/admin/hours_report",
        params: { start_date: "2026-05-01", end_date: "2026-05-15", user_id: employee.id },
        headers: auth_headers

    expect(response).to have_http_status(:ok)
    expect(json.dig(:summary, :total_hours)).to eq(11.95)
    expect(json.dig(:employees, 0, :total_hours)).to eq(11.95)
    expect(json.dig(:breakdowns, :by_category, 0)).to include(
      name: "Flight Instruction", total_hours: 11.95, regular_hours: 11.95, overtime_hours: 0.0, entries_count: 1
    )
    expect(json.dig(:breakdowns, :by_source, 0)).to include(
      source: "mobile", total_hours: 11.95, regular_hours: 11.95, overtime_hours: 0.0, entries_count: 1
    )
  end

  it "filters approved legacy entries that need category remediation" do
    categorized = create_entry(user: employee, date: Date.new(2026, 5, 4), hours: 4)
    uncategorized = create_entry(user: employee, date: Date.new(2026, 5, 5), hours: 3)
    other_employee = create(:user, :employee, first_name: "Already", last_name: "Categorized")
    create_entry(user: other_employee, date: Date.new(2026, 5, 5), hours: 2)
    uncategorized.update_columns(time_category_id: nil)

    get "/api/v1/admin/hours_report",
        params: { start_date: "2026-05-01", end_date: "2026-05-15", category_status: "uncategorized" },
        headers: auth_headers

    expect(response).to have_http_status(:ok)
    expect(json.dig(:summary, :total_hours)).to eq(3.0)
    expect(json.fetch(:employees).pluck(:id)).to eq([ employee.id ])
    expect(json.dig(:employees, 0, :days, 0, :entries).pluck(:id)).to eq([ uncategorized.id ])
    expect(json.dig(:employees, 0, :days, 0, :entries).pluck(:id)).not_to include(categorized.id)
  end

  it "keeps pending entries visible as exclusions without blocking cutoff readiness" do
    create_entry(user: employee, date: Date.new(2026, 6, 16), hours: 6)
    create_entry(user: employee, date: Date.new(2026, 6, 17), hours: 2).update!(approval_status: "pending")

    get "/api/v1/admin/hours_report",
        params: {
          start_date: "2026-06-16",
          end_date: "2026-06-30",
          user_id: employee.id,
          approval_status: "approved_or_standard"
        },
        headers: auth_headers

    expect(response).to have_http_status(:ok)
    expect(json.fetch(:ready)).to be(true)
    expect(json.dig(:summary, :total_hours)).to eq(6.0)
    expect(json.dig(:summary, :pending_count)).to eq(1)
    expect(json.dig(:employees, 0, :ready)).to be(true)
  end

  it "shows entry-level payment status and unresolved prior-period time for one employee" do
    paid_entry = create_entry(user: employee, date: Date.new(2026, 8, 14), hours: 4)
    pending_entry = create_entry(user: employee, date: Date.new(2026, 8, 15), hours: 1.5)
    pending_entry.update!(approval_status: "pending")
    batch = Payroll::BatchFinalizer.new(start_date: "2026-08-01", end_date: "2026-08-15", actor: admin).call
    batch_row = batch.payroll_batch_entries.find_by!(source_time_entry_id: paid_entry.id)
    PayrollEntryProcessingEvent.create!(
      payroll_batch: batch,
      event_id: "cornerstone-entry-paid-report",
      source_time_entry_id: paid_entry.id,
      source_user_uuid: batch_row.source_user_uuid,
      status: "payment_issued",
      occurred_at: Time.zone.parse("2026-08-31 12:00:00"),
      external_system: "cornerstone_payroll",
      external_pay_period_id: "42",
      external_payroll_item_id: "99",
      payment_method: "paper_check",
      payment_reference: "5001"
    )

    get "/api/v1/admin/hours_report",
        params: { start_date: "2026-08-01", end_date: "2026-08-15", user_id: employee.id },
        headers: auth_headers

    expect(response).to have_http_status(:ok)
    expect(json.dig(:summary, :payroll_statuses)).to eq(payment_issued: 1, awaiting_approval: 1)
    expect(json.dig(:employees, 0, :payroll_statuses)).to eq(payment_issued: 1, awaiting_approval: 1)
    paid_lifecycle = json.dig(:employees, 0, :days, 0, :entries, 0, :payroll_lifecycle)
    expect(paid_lifecycle).to include(status: "payment_issued", label: "Paid", payment_reference: "5001")
    expect(paid_lifecycle.dig(:settlements, 0)).to include(
      batch_id: batch.public_id,
      status: "payment_issued",
      total_hours: 4.0
    )
    expect(json.dig(:employees, 0, :excluded_entries, 0)).to include(
      id: pending_entry.id,
      payroll_lifecycle: include(status: "awaiting_approval")
    )
  end

  it "exports one detailed CSV row per entry segment with an immutable reference" do
    first = create_entry(user: employee, date: Date.new(2026, 6, 16), hours: 3, start_hour: 9)
    first.update!(
      approved_by: admin,
      approved_at: Time.zone.parse("2026-06-17 08:00:00"),
      description: "=HYPERLINK(\"https://example.test\", \"Open\")"
    )
    create_entry(user: employee, date: Date.new(2026, 6, 16), hours: 2, start_hour: 14)

    expect do
      get "/api/v1/admin/hours_report/detailed_csv",
          params: { start_date: "2026-06-16", end_date: "2026-06-30", user_id: employee.id },
          headers: auth_headers
    end.to change(ReportExport, :count).by(1)

    expect(response).to have_http_status(:ok)
    expect(response.media_type).to eq("text/csv")
    rows = CSV.parse(response.body, headers: true)
    expect(rows.length).to eq(2)
    expect(rows.map { |row| row["Start"] }).to contain_exactly("9:00 AM", "2:00 PM")
    expect(rows.map { |row| row["Total Hours"] }).to contain_exactly("3.00", "2.00")
    expect(rows.find { |row| row["Total Hours"] == "3.00" }["Description"]).to start_with("'=")
    expect(rows.map { |row| row["Export Reference"] }.uniq).to eq([ ReportExport.last.public_id ])
    expect(ReportExport.last.protects_entries).to be(true)
    expect(ReportExport.last.entry_ids).to contain_exactly(first.id, TimeEntry.order(:id).last.id)
  end

  it "generates a server-side employee timesheet PDF without requiring a finalized week" do
    context_entry = create_entry(user: employee, date: Date.new(2026, 6, 15), hours: 8)
    first_entry = create_entry(user: employee, date: Date.new(2026, 6, 16), hours: 6)
    other_category = create(:time_category, name: "Office Support")
    second_entry = create_entry(user: employee, date: Date.new(2026, 6, 17), hours: 2)
    second_entry.update!(time_category: other_category)

    expect do
      get "/api/v1/admin/hours_report/timesheet_pdf",
          params: { start_date: "2026-06-16", end_date: "2026-06-30", user_id: employee.id, time_category_id: category.id },
          headers: auth_headers
    end.to change(ReportExport, :count).by(1)

    expect(response).to have_http_status(:ok)
    expect(response.media_type).to eq("application/pdf")
    expect(response.body).to start_with("%PDF")
    expect(response.headers.fetch("Content-Disposition")).to include("AIRE_Timesheet_Alice_Pilot_2026-06-16_to_2026-06-30.pdf")
    expect(ReportExport.last).to have_attributes(export_type: "employee_timesheet_pdf", readiness_status: "complete", protects_entries: true)
    expect(ReportExport.last.entry_ids).to contain_exactly(context_entry.id, first_entry.id, second_entry.id)
    expect(ReportExport.last.entry_snapshot.find { |entry| entry["id"] == context_entry.id }).to include(
      "snapshot_role" => "ledger_dependency",
      "total_hours" => 8.0
    )

    patch "/api/v1/time_entries/#{context_entry.id}",
          params: { time_entry: { description: "Corrected context entry" } },
          headers: auth_headers

    expect(response).to have_http_status(:unprocessable_entity)
    expect(json.fetch(:code)).to eq("correction_reason_required")
    expect(json.fetch(:export_references)).to eq([ ReportExport.last.public_id ])
  end

  it "generates a consolidated PDF for the default all-employee report" do
    employee.update!(first_name: "Māria", last_name: "Čamoru")
    category.update!(name: "Māpåla Support")
    other_employee = create(:user, :employee, first_name: "Bob", last_name: "Žukov", approval_group: "ops_maintenance")
    alice_entry = create_entry(user: employee, date: Date.new(2026, 6, 16), hours: 6)
    bob_entry = create_entry(user: other_employee, date: Date.new(2026, 6, 17), hours: 7)

    expect do
      get "/api/v1/admin/hours_report/pdf",
          params: { start_date: "2026-06-16", end_date: "2026-06-30", status: "current" },
          headers: auth_headers
    end.to change(ReportExport, :count).by(1)

    expect(response).to have_http_status(:ok)
    expect(response.media_type).to eq("application/pdf")
    expect(response.body).to start_with("%PDF")
    expect(response.headers.fetch("Content-Disposition")).to include("AIRE_Payroll_Hours_2026-06-16_to_2026-06-30.pdf")
    expect(ReportExport.last).to have_attributes(export_type: "payroll_hours_pdf", readiness_status: "complete", protects_entries: true)
    expect(ReportExport.last.employee_ids).to contain_exactly(employee.id, other_employee.id)
    expect(ReportExport.last.entry_ids).to contain_exactly(alice_entry.id, bob_entry.id)
  end

  it "uses the official employee timesheet for the primary PDF export when an employee is selected" do
    employee.update!(first_name: "Māria", last_name: "Čamoru")
    category.update!(name: "Māpåla Support")
    create_entry(user: employee, date: Date.new(2026, 6, 16), hours: 6)

    get "/api/v1/admin/hours_report/pdf",
        params: { start_date: "2026-06-16", end_date: "2026-06-30", user_id: employee.id },
        headers: auth_headers

    expect(response).to have_http_status(:ok)
    expect(response.media_type).to eq("application/pdf")
    expect(response.headers.fetch("Content-Disposition")).to include("AIRE_Timesheet_Maria_Camoru_2026-06-16_to_2026-06-30.pdf")
    expect(ReportExport.last.export_type).to eq("employee_timesheet_pdf")
  end

  it "requires explicit acknowledgement before exporting approved hours without a category" do
    entry = create_entry(user: employee, date: Date.new(2026, 6, 16), hours: 6)
    entry.update_columns(time_category_id: nil)

    get "/api/v1/admin/hours_report/timesheet_pdf",
        params: { start_date: "2026-06-16", end_date: "2026-06-30", user_id: employee.id },
        headers: auth_headers

    expect(response).to have_http_status(:unprocessable_entity)
    expect(json.fetch(:code)).to eq("draft_acknowledgement_required")

    get "/api/v1/admin/hours_report/timesheet_pdf",
        params: { start_date: "2026-06-16", end_date: "2026-06-30", user_id: employee.id, acknowledge_draft: true },
        headers: auth_headers

    expect(response).to have_http_status(:ok)
    expect(ReportExport.last.readiness_status).to eq("draft")
  end

  it "requires explicit acknowledgement for a consolidated PDF with missing categories" do
    entry = create_entry(user: employee, date: Date.new(2026, 6, 16), hours: 6)
    entry.update_columns(time_category_id: nil)

    get "/api/v1/admin/hours_report/pdf",
        params: { start_date: "2026-06-16", end_date: "2026-06-30" },
        headers: auth_headers

    expect(response).to have_http_status(:unprocessable_entity)
    expect(json.fetch(:code)).to eq("draft_acknowledgement_required")
    expect(ReportExport.where(export_type: "payroll_hours_pdf")).to be_empty

    get "/api/v1/admin/hours_report/pdf",
        params: { start_date: "2026-06-16", end_date: "2026-06-30", acknowledge_draft: true },
        headers: auth_headers

    expect(response).to have_http_status(:ok)
    expect(ReportExport.last).to have_attributes(export_type: "payroll_hours_pdf", readiness_status: "draft")
  end
end
