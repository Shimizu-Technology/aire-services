# frozen_string_literal: true

require "rails_helper"
require "csv"
require "pdf/reader"

RSpec.describe "Shared live payroll approval numbers", type: :request do
  let(:admin) { create(:user, :admin) }
  let(:worker) { create(:user, :employee) }
  let(:category) { create(:time_category) }
  let(:headers) { { "Authorization" => "Bearer test_token_#{admin.id}" } }
  let(:range) { { start_date: "2026-11-01", end_date: "2026-11-15" } }
  let(:zone) { ActiveSupport::TimeZone["Pacific/Guam"] }

  def shift(day, hours, approval: "approved")
    from = zone.local(2026, 11, day, 7)
    create(:time_entry, user: worker, time_category: category, work_date: from.to_date,
      start_time: from, end_time: from + hours.hours, clock_in_at: from, clock_out_at: from + hours.hours,
      hours: hours, status: "completed", entry_method: "clock", approval_status: approval)
  end

  before do
    [ 2, 3, 4, 5 ].each { |day| shift(day, 8) }
    @overtime = shift(6, 11.5)
    @overtime.update_columns(overtime_status: "pending")
    shift(9, 2, approval: "pending")
    shift(10, 3, approval: "denied")
  end

  it "uses the lock's regular-only inclusion for an approved shift with pending overtime everywhere" do
    report = Payroll::HoursReportBuilder.new(range).call
    expect(report.dig(:summary, :payroll_hours)).to eq(approved_regular_hours: 40.0, approved_overtime_hours: 0.0,
      approved_hours: 40.0, time_waiting_hours: 2.0, overtime_waiting_hours: 3.5)
    expect(report[:employees].first[:approval_complete]).to be(false)
    expect(report[:summary][:total_hours]).to eq(43.5) # raw worked ledger is retained
    summary_only = Payroll::HoursReportBuilder.new(range.merge(summary_only: true)).call
    expect(summary_only[:summary]).to eq(report[:summary])
    expect(summary_only[:employees].first[:payroll_hours]).to eq(report[:employees].first[:payroll_hours])
    today = Payroll::PeriodHandoffState.live_hours(Date.new(2026, 11, 1), Date.new(2026, 11, 15))
    expect(today).to include(approved_hours: 40.0, time_waiting_hours: 2.0, overtime_waiting_hours: 3.5, waiting_hours: 5.5)
    approved_only = Payroll::HoursReportBuilder.new(range.merge(approval_status: "approved_or_standard")).call
    expect(approved_only.dig(:summary, :payroll_hours)).to eq(report.dig(:summary, :payroll_hours))
    get "/api/v1/time_entries", params: range.merge(user_id: worker.id, acknowledge_draft: true), headers: headers
    parts = response.parsed_body.fetch("time_entries").flat_map { |entry| entry.fetch("payroll_hours_by_date") }
    expect(parts.sum { |part| part.fetch("approved_hours") }).to eq(40.0)
    expect(parts.sum { |part| part.fetch("overtime_waiting_hours") }).to eq(3.5)
    batch = Payroll::BatchBuilder.new(**range).call
    expect(batch[:summary]).to include(regular_hours: 40.0, overtime_hours: 0.0, total_hours: 40.0)
    row = batch[:rows].find { |entry| entry[:source_time_entry_id] == @overtime.id }
    expect(row).to include(regular_hours: 8.0, overtime_hours: 0.0)
  end

  it "separates pending overtime in CSV/PDF without changing capture's worked-time snapshot" do
    get "/api/v1/admin/hours_report/summary_csv", params: range.merge(acknowledge_draft: true), headers: headers
    expect(response).to have_http_status(:ok)
    row = CSV.parse(response.body, headers: true).first
    expect(row.to_h).to include("Approved regular hours" => "40.00", "Approved overtime hours" => "0.00", "Worked hours" => "48.50",
      "Approved for payroll" => "40.00", "Time waiting for approval" => "2.00",
      "Overtime waiting for approval — not included" => "3.50", "Report Status" => "Draft - needs review")
    capture = ReportExport.last
    expect(capture.protects_entries).to be(false)
    expect(capture.entry_snapshot.find { |entry| entry["id"] == @overtime.id }).to include("total_hours" => 11.5, "overtime_hours" => 3.5)
    checksum = capture.checksum
    get "/api/v1/admin/hours_report/pdf", params: range.merge(acknowledge_draft: true), headers: headers
    expect(response).to have_http_status(:ok)
    text = PDF::Reader.new(StringIO.new(response.body)).pages.map(&:text).join(" ").gsub(/\s+/, " ")
    expect(text).to include("Approved for payroll", "Overtime waiting for approval", "not included", "40.00", "3.50", "Draft - needs review", "Draft — 1 shift and 3.50h of overtime are still waiting for approval. Only approved hours are included.")
    get "/api/v1/admin/hours_report/pdf", params: range.merge(user_id: worker.id, acknowledge_draft: true), headers: headers
    expect(response).to have_http_status(:ok)
    employee_pdf = PDF::Reader.new(StringIO.new(response.body)).pages.map(&:text).join(" ").gsub(/\s+/, " ")
    expect(employee_pdf).to include("Approved for payroll", "Overtime waiting for approval", "not included", "40.00", "3.50")
    expect(capture.reload.checksum).to eq(checksum)
  end

  it "requires acknowledgement for every row shown as Draft" do
    get "/api/v1/admin/hours_report/summary_csv", params: range, headers: headers
    expect(response).to have_http_status(:unprocessable_entity)
    expect(response.parsed_body["code"]).to eq("draft_acknowledgement_required")
    get "/api/v1/admin/hours_report/summary_csv", params: range.merge(acknowledge_draft: true), headers: headers
    expect(response).to have_http_status(:ok)
    expect(CSV.parse(response.body, headers: true).first["Report Status"]).to eq("Draft - needs review")
  end

  it "allows Complete when a stale pending-OT flag represents zero waiting hours" do
    TimeEntry.where(user: worker).delete_all
    row = shift(2, 8)
    row.update_columns(overtime_status: "pending")
    report = Payroll::HoursReportBuilder.new(range).call
    expect(report[:employees].first[:approval_complete]).to be(true)
    get "/api/v1/admin/hours_report/summary_csv", params: range, headers: headers
    expect(response).to have_http_status(:ok)
    expect(CSV.parse(response.body, headers: true).first["Report Status"]).to eq("Complete")
  end

  it "labels filtered summaries and preserves filtered worked hours beside period approval facts" do
    filters = range.merge(approval_status: "denied")
    get "/api/v1/admin/hours_report/summary_csv", params: filters.merge(acknowledge_draft: true), headers: headers
    expect(response).to have_http_status(:ok)
    csv = CSV.parse(response.body, headers: true)
    expect(csv.headers[4..6]).to eq([ "Approved regular hours", "Approved overtime hours", "Approved for payroll" ])
    expect(csv.headers.count("Approved for payroll")).to eq(1)
    expect(csv.first.to_h).to include("Worked hours" => "48.50", "Approved for payroll" => "40.00",
      "Time waiting for approval" => "2.00", "Overtime waiting for approval — not included" => "3.50")
    expect(response.headers["Content-Disposition"]).to include("Filtered")
    get "/api/v1/admin/hours_report/pdf", params: filters.merge(acknowledge_draft: true), headers: headers
    expect(response).to have_http_status(:ok)
    expect(response.headers["Content-Disposition"]).to include("Filtered")
    reader = PDF::Reader.new(StringIO.new(response.body))
    expect(reader.info[:Title]).to start_with("Filtered —")
    expect(reader.pages.map(&:text).join(" ").gsub(/\s+/, " ")).to include(Reports::HoursReportDisclosure::APPROVAL_FACTS_NOTE)
  end

  it "marks a zero-included pending-filter PDF as draft and discloses the empty selection" do
    get "/api/v1/admin/hours_report/pdf", params: range.merge(approval_status: "pending", acknowledge_draft: true), headers: headers
    expect(response).to have_http_status(:ok)
    text = PDF::Reader.new(StringIO.new(response.body)).pages.map(&:text).join(" ").gsub(/\s+/, " ")
    expect(text).to include("Draft — 1 shift and 3.50h of overtime are still waiting for approval.",
      "No included entries match this selection.", "0 included entries")
    expect(text).not_to include("Included hours ready")
  end

  it "uses ready wording only after actual waiting hours are resolved, ignoring stale OT flags" do
    TimeEntry.where(user: worker).delete_all
    row = shift(2, 8)
    row.update_columns(overtime_status: "pending")
    get "/api/v1/admin/hours_report/pdf", params: range, headers: headers
    expect(response).to have_http_status(:ok)
    text = PDF::Reader.new(StringIO.new(response.body)).pages.map(&:text).join(" ").gsub(/\s+/, " ")
    expect(text).to include("Included hours ready — nothing is waiting for approval.")
    expect(text).not_to include("Draft —")
  end

  [ { approval_status: "denied" }, { overtime_status: "pending" } ].each do |status_filter|
    it "keeps weekly approvals additive and approved weeks visible under #{status_filter}" do
      shift(15, 6.25)
      report = Payroll::HoursReportBuilder.new(range.merge(status_filter).merge(user_id: worker.id)).call
      employee = report[:employees].first
      weeks = employee.fetch(:weeks)
      expect(Payroll::ApprovalHours.sum(weeks.pluck(:payroll_hours))).to eq(employee[:payroll_hours])
      expect(weeks.find { |week| week[:week_start] == "2026-11-01" }.dig(:payroll_hours, :approved_hours)).to eq(40.0)
      retained = weeks.find { |week| week[:week_start] == "2026-11-15" }
      expect(retained).to include(period_hours: 0.0, regular_hours: 0.0, overtime_hours: 0.0)
      expect(retained.dig(:payroll_hours, :approved_hours)).to eq(6.25)
      expect(employee[:days].flat_map { |day| day[:entries] }.map { |entry| entry[:id] })
        .to eq(status_filter.key?(:approval_status) ? [] : [ @overtime.id ])

      # Render the same filtered report through both documents; the selected
      # employee endpoint intentionally uses its broader full-ledger selection.
      [ Reports::EmployeeTimesheetPdf, Reports::PayrollHoursPdf ].each do |renderer|
        export = ReportExport.capture!(export_type: "employee_timesheet_pdf", report: report, generated_by: admin)
        bytes = renderer.new(report: report, export: export, generated_by: admin).render
        text = PDF::Reader.new(StringIO.new(bytes)).pages.map(&:text).join(" ").gsub(/\s+/, " ")
        expect(text).to match(/Nov 15, 2026 to Nov 21, 2026 6\.25 6\.25 0\.00 6\.25/)
      end
    end
  end

  it "keeps frozen export bytes, payload and checksum unchanged when live reports are generated" do
    post "/api/v1/admin/payroll_batches", params: range, headers: headers
    expect(response).to have_http_status(:created)
    id = response.parsed_body.fetch("id")
    batch = PayrollBatch.find_by!(public_id: id)
    original = batch.attributes.deep_dup
    get "/api/v1/admin/payroll_batches/#{id}/export", headers: headers
    frozen_csv = response.body.dup
    expect(CSV.parse(frozen_csv).first).to eq([
      "Batch ID", "Period start", "Period end", "Lock at (Guam, ChST UTC+10)", "Employee", "Email",
      "Source entry", "Type", "Original work date", "Category", "Regular hours", "Overtime hours", "Total hours"
    ])
    get "/api/v1/admin/hours_report/summary_csv", params: range.merge(acknowledge_draft: true), headers: headers
    expect(response).to have_http_status(:ok)
    get "/api/v1/admin/payroll_batches/#{id}/export", headers: headers
    expect(response.body).to eq(frozen_csv)
    expect(batch.reload.attributes).to eq(original)
  end

  it "requires a valid allocation approval, and Complete requires all waiting time to be resolved" do
    @overtime.update_columns(overtime_status: "approved", overtime_allocation_signature: [])
    expect(Payroll::HoursReportBuilder.new(range).call.dig(:summary, :payroll_hours, :approved_overtime_hours)).to eq(0.0)
    allocation = Payroll::AffectedOvertimeReview.allocation_for(@overtime)
    @overtime.update_columns(allocation_contract_version: Payroll::WeeklyOvertimeAllocator::CONTRACT_VERSION,
      overtime_allocation_signature: Payroll::AffectedOvertimeReview.signature(@overtime, allocation))
    report = Payroll::HoursReportBuilder.new(range).call
    expect(report.dig(:summary, :payroll_hours, :approved_overtime_hours)).to eq(3.5)
    expect(report[:employees].first[:approval_complete]).to be(false)
    TimeEntry.where(user: worker, approval_status: "pending").update_all(approval_status: "denied")
    expect(Payroll::HoursReportBuilder.new(range).call[:employees].first[:approval_complete]).to be(true)
  end
  it "counts denied overtime as neither payroll approved nor waiting" do
    @overtime.update_columns(overtime_status: "denied")
    hours = Payroll::HoursReportBuilder.new(range).call.dig(:summary, :payroll_hours)
    expect(hours).to include(approved_hours: 40.0, approved_overtime_hours: 0.0, overtime_waiting_hours: 0.0, time_waiting_hours: 2.0)
  end
end
