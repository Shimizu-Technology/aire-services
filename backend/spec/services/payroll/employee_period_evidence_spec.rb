# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::EmployeePeriodEvidence do
  let(:employee) { create(:user, :employee) }

  def entry(hours, date = Date.new(2026, 9, 8), approval = "approved")
    row = create(:time_entry, user: employee, work_date: date, status: "completed", entry_method: "manual", approval_status: approval, overtime_status: "none")
    row.update_columns(hours: hours)
    row.reload
  end

  def allocation(row, hours, status)
    PayrollManualAllocation.create!(time_entry: row, user: employee, recorded_by: employee, source_user_uuid: employee.payroll_integration_uuid,
      source_time_entry_version: row.lock_version, work_date: row.work_date, pay_date: Date.new(2026, 9, 30), regular_hours: hours, overtime_hours: 0,
      status: status, reason: "Reviewed check evidence", external_pay_period_id: "payroll-1", external_payroll_item_id: SecureRandom.uuid,
      payment_effective_on: status == "issued" ? Date.new(2026, 9, 30) : nil)
  end

  def line(batch, row, regular, overtime = 0, kind = "current")
    batch.payroll_batch_entries.create!(source_time_entry_id: row.id, source_user_id: employee.id, source_user_uuid: employee.payroll_integration_uuid,
      work_date: row.work_date, week_start: row.work_date.beginning_of_week(:sunday), line_key: SecureRandom.uuid, source_kind: kind,
      regular_hours: regular, overtime_hours: overtime, total_hours: regular + overtime, snapshot: {})
  end

  def receipt(batch, row, status)
    PayrollEntryProcessingEvent.create!(payroll_batch: batch, source_time_entry_id: row.source_time_entry_id,
      source_user_uuid: employee.payroll_integration_uuid, contract_version: "2.0", source_line_key: row.line_key, source_kind: row.source_kind,
      regular_hours: row.regular_hours, overtime_hours: row.overtime_hours, total_hours: row.total_hours,
      event_id: SecureRandom.uuid, external_system: "cornerstone_payroll", external_pay_period_id: "destination", external_payroll_item_id: "item-1", status: status, occurred_at: Time.current)
  end

  def result(params = {})
    described_class.new(user: employee, params: params).call
  end

  it "separates issued, committed, unresolved and pending coverage without claiming debt" do
    row = entry(12)
    allocation(row, 6, "issued")
    allocation(row, 4, "committed")
    entry(3, Date.new(2026, 9, 9), "pending")
    expect(result[:totals]).to include(worked_hours: 15.0, eligible_hours: 12.0, issued_hours: 6.0, committed_hours: 4.0, needs_reconciliation_hours: 2.0, pending_hours: 3.0)
    expect(result).to include(amount_owed: nil, actual_check_components: nil)
  end

  it "preserves frozen classification and signed corrections under original work dates" do
    row = entry(10)
    original = create(:payroll_batch)
    old = line(original, row, 8, 2)
    receipt(original, old, "payment_issued")
    correction = create(:payroll_batch, start_date: Date.new(2026, 10, 1), end_date: Date.new(2026, 10, 15))
    delta = line(correction, row, 2, -2, "correction")
    receipt(correction, delta, "committed")
    detail = described_class.new(user: employee).call(period_id: "2026-09-01")[:period]
    expect(detail[:summary]).to include(current_regular_hours: 10.0, current_overtime_hours: 0.0, issued_hours: 10.0, committed_hours: 0.0, unissued_correction_count: 1)
    expect(detail[:coverage_lines]).to contain_exactly(include(regular_hours: 8.0, overtime_hours: 2.0, actual_check_components: nil), include(regular_hours: 2.0, overtime_hours: -2.0, source_kind: "correction", actual_check_components: nil))
    expect(result[:periods].size).to eq(1)
  end

  it "excludes a voided allocation from issued replacement coverage" do
    row = entry(8)
    allocation(row, 8, "voided")
    allocation(row, 8, "issued")
    expect(result[:totals]).to include(issued_hours: 8.0, needs_reconciliation_hours: 0.0)
  end

  it "retains frozen evidence when the source row is deleted" do
    row = entry(8)
    batch = create(:payroll_batch)
    receipt(batch, line(batch, row, 8), "payment_issued")
    row.delete
    expect(result[:totals]).to include(worked_hours: 0.0, issued_hours: 8.0)
    expect(described_class.new(user: employee).call(period_id: "2026-09-01")[:period][:entries]).to be_empty
  end

  it "includes former and kiosk-only people" do
    entry(8)
    employee.update_columns(is_active: false, personal_access_enabled: false)
    expect(result[:employee]).to include(active: false)
    expect(result[:totals][:worked_hours]).to eq(8.0)
  end

  it "keeps complete totals across more than 100 cursor pages and binds identity and filters" do
    105.times { |index| entry(1, Date.new(2017, 1, 1).next_month(index)) }
    first = result(per_page: 1)
    expect(first[:pagination][:total_count]).to eq(105)
    expect(first[:totals][:worked_hours]).to eq(105.0)
    second = result(per_page: 1, cursor: first[:pagination][:next_cursor])
    expect(second[:totals]).to eq(first[:totals])
    expect(second[:periods].first[:id]).to be < first[:periods].first[:id]
    expect { result(start_date: "2020-01-01", cursor: first[:pagination][:next_cursor]) }.to raise_error(ArgumentError, /Cursor/)
    expect { described_class.new(user: create(:user, :employee), params: { cursor: first[:pagination][:next_cursor] }).call }.to raise_error(ArgumentError, /Cursor/)
  end

  it "uses adjacent-period Sunday-week context for current OT" do
    entry(40, Date.new(2026, 9, 14))
    entry(2, Date.new(2026, 9, 16))
    expect(result(start_date: "2026-09-16", end_date: "2026-09-30")[:totals]).to include(current_regular_hours: 0.0, current_overtime_hours: 2.0)
  end

  it "retains a legacy null UUID visibly requiring identity review" do
    row = entry(8)
    batch = create(:payroll_batch)
    saved = batch.payroll_batch_entries.create!(source_time_entry_id: row.id, source_user_id: employee.id,
      work_date: row.work_date, week_start: row.work_date.beginning_of_week(:sunday), line_key: "legacy",
      source_kind: "current", regular_hours: 8, overtime_hours: 0, total_hours: 8, snapshot: {})
    expect(saved.source_user_uuid).to be_nil
    expect(result[:periods].first).to include(review_required: true)
    expect(result[:totals][:identity_review_count]).to eq(1)
    expect(saved.reload.source_user_uuid).to be_nil
  end

  it "attributes retained work to the frozen owner after a current entry changes owner" do
    row = entry(8)
    batch = create(:payroll_batch)
    receipt(batch, line(batch, row, 8), "payment_issued")
    other = create(:user, :employee)
    row.update_column(:user_id, other.id)
    expect(result[:totals]).to include(worked_hours: 0.0, issued_hours: 8.0)
    expect(described_class.new(user: other).call[:totals]).to include(worked_hours: 8.0, issued_hours: 0.0, needs_reconciliation_hours: 8.0)
  end

  it "preserves a mismatched frozen identity without counting it as current-person coverage" do
    row = entry(8)
    batch = create(:payroll_batch)
    batch.payroll_batch_entries.create!(source_time_entry_id: row.id, source_user_id: employee.id, source_user_uuid: SecureRandom.uuid,
      work_date: row.work_date, week_start: row.work_date.beginning_of_week(:sunday), line_key: "other-owner",
      source_kind: "current", regular_hours: 8, overtime_hours: 0, total_hours: 8, snapshot: {})
    expect(result[:totals]).to include(exported_hours: 0.0, needs_reconciliation_hours: 8.0, identity_review_count: 1)
    expect(described_class.new(user: employee).call(period_id: "2026-09-01")[:period][:coverage_lines].first).to include(identity_state: "frozen_owner_mismatch", coverage_state: "identity_review")
  end

  it "paginates more than 250 details without changing totals and rejects cross-person cursors" do
    template = entry(1)
    attributes = template.attributes.except("id", "created_at", "updated_at")
    TimeEntry.insert_all!(250.times.map { attributes.merge("created_at" => Time.current, "updated_at" => Time.current) })
    first = described_class.new(user: employee, params: { detail_per_page: 100 }).call(period_id: "2026-09-01")[:period]
    expect(first[:entries].size).to eq(100)
    expect(first[:summary][:worked_hours]).to eq(251.0)
    expect(first[:detail_pagination][:counts][:entries]).to eq(251)
    second = described_class.new(user: employee, params: { detail_per_page: 100, detail_cursor: first[:detail_pagination][:next_cursor] }).call(period_id: "2026-09-01")[:period]
    expect(second[:entries].size).to eq(100)
    expect(second[:summary]).to eq(first[:summary])
    expect(first[:entries].map { |row| row[:id] } & second[:entries].map { |row| row[:id] }).to be_empty
    other = create(:user, :employee)
    create(:time_entry, user: other, work_date: template.work_date)
    expect { described_class.new(user: other, params: { detail_cursor: first[:detail_pagination][:next_cursor] }).call(period_id: "2026-09-01") }.to raise_error(ArgumentError, /Detail cursor/)
    expect { described_class.new(user: employee, params: { start_date: "2026-09-08", detail_cursor: first[:detail_pagination][:next_cursor] }).call(period_id: "2026-09-01") }.to raise_error(ArgumentError, /Detail cursor/)
  end

  it "rejects invalid dates and page sizes" do
    expect { result(start_date: "wrong") }.to raise_error(ArgumentError, /YYYY-MM-DD/)
    expect { result(per_page: 0) }.to raise_error(ArgumentError, /per_page/)
    expect { result(end_date: "2026-01-01", start_date: "2026-02-01") }.to raise_error(ArgumentError, /on or after/)
  end
end
