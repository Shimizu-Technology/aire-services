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
    today = Payroll::PeriodHandoffState.live_hours(Date.new(2026, 11, 1), Date.new(2026, 11, 15))
    expect(today).to include(approved_hours: 40.0, time_waiting_hours: 2.0, overtime_waiting_hours: 3.5, waiting_hours: 5.5)
    batch = Payroll::BatchBuilder.new(**range).call
    expect(batch[:summary]).to include(regular_hours: 40.0, overtime_hours: 0.0, total_hours: 40.0)
    row = batch[:rows].find { |entry| entry[:source_time_entry_id] == @overtime.id }
    expect(row).to include(regular_hours: 8.0, overtime_hours: 0.0)
  end

  it "separates pending overtime in CSV/PDF without changing capture's worked-time snapshot" do
    get "/api/v1/admin/hours_report/summary_csv", params: range, headers: headers
    expect(response).to have_http_status(:ok)
    row = CSV.parse(response.body, headers: true).first
    expect(row.to_h).to include("Regular Hours" => "40.00", "Overtime Hours" => "0.00", "Total Hours" => "40.00",
      "Approved for payroll" => "40.00", "Time waiting for approval" => "2.00",
      "Overtime waiting for approval — not included" => "3.50", "Report Status" => "Draft - needs review")
    capture = ReportExport.last
    expect(capture.protects_entries).to be(true)
    expect(capture.entry_snapshot.find { |entry| entry["id"] == @overtime.id }).to include("total_hours" => 11.5, "overtime_hours" => 3.5)
    checksum = capture.checksum
    get "/api/v1/admin/hours_report/pdf", params: range, headers: headers
    expect(response).to have_http_status(:ok)
    text = PDF::Reader.new(StringIO.new(response.body)).pages.map(&:text).join(" ").gsub(/\s+/, " ")
    expect(text).to include("Approved for payroll", "Overtime waiting for approval", "not included", "40.00", "3.50", "Needs review")
    expect(capture.reload.checksum).to eq(checksum)
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
end
