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
    batch.payroll_batch_entries.create!(source_time_entry_id: row.id, source_user_id: employee.id, source_user_uuid: employee.payroll_integration_uuid, source_category_id: row.time_category_id,
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

  it "keeps a source-only frozen category gap visible without replacing it with a current category" do
    row = entry(8)
    batch = create(:payroll_batch)
    batch.payroll_batch_entries.create!(source_time_entry_id: row.id, source_user_id: employee.id,
      source_user_uuid: employee.payroll_integration_uuid, source_category_id: nil,
      work_date: row.work_date, week_start: row.work_date.beginning_of_week(:sunday), line_key: "uncategorized-frozen",
      source_kind: "current", regular_hours: 8, overtime_hours: 0, total_hours: 8, snapshot: {})
    expect(result[:totals]).to include(uncategorized_entry_count: 0, retained_uncategorized_line_count: 1)
    row.delete
    expect(result[:periods].first).to include(review_required: true)
    expect(result[:totals]).to include(worked_hours: 0.0, retained_uncategorized_line_count: 1)
    expect(described_class.new(user: employee).call(period_id: "2026-09-01")[:period][:coverage_lines].first[:source_category_id]).to be_nil
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
    PayrollBatchProcessingEvent.create!(payroll_batch: batch, event_id: SecureRandom.uuid, external_system: "cornerstone_payroll", status: "payment_issued", occurred_at: Time.current)
    expect(result[:totals]).to include(issued_hours: 0.0, exported_hours: 0.0, needs_reconciliation_hours: 8.0, identity_review_count: 1)
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

  it "attributes frozen work by stable UUID across a saved numeric owner change without moving current work" do
    row = entry(8)
    other = create(:user, :employee)
    row.update_column(:user_id, other.id)
    batch = create(:payroll_batch)
    saved = batch.payroll_batch_entries.create!(source_time_entry_id: row.id, source_user_id: other.id,
      source_user_uuid: employee.payroll_integration_uuid, source_category_id: row.time_category_id,
      work_date: row.work_date, week_start: row.work_date.beginning_of_week(:sunday), line_key: "stable-owner",
      source_kind: "current", regular_hours: 8, overtime_hours: 0, total_hours: 8, snapshot: {})
    receipt(batch, saved, "payment_issued")
    stranger = create(:user, :employee)
    batch.payroll_batch_entries.create!(source_time_entry_id: row.id + 1000, source_user_id: stranger.id,
      source_user_uuid: stranger.payroll_integration_uuid, source_category_id: row.time_category_id,
      work_date: row.work_date, week_start: row.work_date.beginning_of_week(:sunday), line_key: "unrelated-owner",
      source_kind: "current", regular_hours: 3, overtime_hours: 0, total_hours: 3, snapshot: {})
    expect(result[:totals]).to include(worked_hours: 0.0, issued_hours: 8.0, identity_review_count: 0)
    detail = described_class.new(user: employee).call(period_id: "2026-09-01")[:period]
    expect(detail[:coverage_lines]).to contain_exactly(include(source_user_id: other.id.to_s, source_user_uuid: employee.payroll_integration_uuid, source_time_entry_id: row.id.to_s))
    expect(described_class.new(user: other).call[:totals]).to include(worked_hours: 8.0, issued_hours: 0.0, identity_review_count: 1, needs_reconciliation_hours: 8.0)
    expect(saved.reload.source_user_id).to eq(other.id)
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

  it "preserves a saved regular split when current Sunday-week evidence classifies the work as OT" do
    entry(40, Date.new(2026, 9, 14))
    row = entry(2, Date.new(2026, 9, 16))
    batch = create(:payroll_batch, start_date: Date.new(2026, 9, 16), end_date: Date.new(2026, 9, 30))
    receipt(batch, line(batch, row, 2), "payment_issued")
    detail = described_class.new(user: employee).call(period_id: "2026-09-16")[:period]
    expect(detail[:summary]).to include(current_regular_hours: 0.0, current_overtime_hours: 2.0, frozen_regular_hours: 2.0, frozen_overtime_hours: 0.0, issued_hours: 2.0)
    expect(detail[:actual_check_components]).to be_nil
  end

  it "retains an evidence hold on the original employee when the current row changes owner" do
    row = entry(8)
    PayrollPaymentAttestation.create!(time_entry: row, user: employee, recorded_by: employee,
      source_user_uuid: employee.payroll_integration_uuid, source_time_entry_version: row.lock_version,
      work_date: row.work_date, hours: 8, reason: "Exact check still needs review", attested_at: Time.current)
    row.update_column(:user_id, create(:user, :employee).id)
    expect(result[:totals]).to include(worked_hours: 0.0, held_hours: 8.0)
    detail = described_class.new(user: employee).call(period_id: "2026-09-01")[:period]
    expect(detail[:coverage_lines].first).to include(source_kind: "payment_attestation", coverage_state: "evidence_hold", regular_hours: nil, overtime_hours: nil)
  end

  it "pins an entry beyond the first page without changing full period totals or leaking another employee" do
    template = entry(1)
    attributes = template.attributes.except("id", "created_at", "updated_at")
    TimeEntry.insert_all!(250.times.map { attributes.merge("created_at" => Time.current, "updated_at" => Time.current) })
    target = TimeEntry.where(user: employee).order(:id).last
    batch = create(:payroll_batch)
    receipt(batch, line(batch, target, 1), "payment_issued")
    detail = described_class.new(user: employee, params: { entry_id: target.id }).call(period_id: "2026-09-01")[:period]
    expect(detail[:summary][:worked_hours]).to eq(251.0)
    expect(detail[:entries].pluck(:id)).to eq([ target.id.to_s ])
    expect(detail[:coverage_lines].pluck(:source_time_entry_id)).to eq([ target.id.to_s ])
    stranger = create(:time_entry, user: create(:user, :employee), work_date: template.work_date)
    expect { described_class.new(user: employee, params: { entry_id: stranger.id }).call(period_id: "2026-09-01") }.to raise_error(ActiveRecord::RecordNotFound)
    cursor = described_class.new(user: employee, params: { detail_per_page: 1 }).call(period_id: "2026-09-01")[:period][:detail_pagination][:next_cursor]
    expect { described_class.new(user: employee, params: { detail_per_page: 1, entry_id: target.id, detail_cursor: cursor }).call(period_id: "2026-09-01") }.to raise_error(ArgumentError, /Detail cursor/)
  end

  it "preserves issued over-coverage as evidence and does not invent negative remaining hours or money owed" do
    row = entry(8)
    allocation(row, 10, "issued")
    detail = described_class.new(user: employee).call(period_id: "2026-09-01")[:period]
    expect(detail[:entries].first).to include(eligible_hours: 8.0, issued_hours: 10.0, needs_reconciliation_hours: 0.0)
    expect(detail[:summary]).to include(eligible_hours: 8.0, issued_hours: 10.0, needs_reconciliation_hours: 0.0)
    expect(detail[:amount_owed]).to be_nil
  end

  it "shows batch-only payment status without claiming exact-line coverage" do
    row = entry(8)
    batch = create(:payroll_batch)
    line(batch, row, 8)
    PayrollBatchProcessingEvent.create!(payroll_batch: batch, event_id: SecureRandom.uuid, external_system: "cornerstone_payroll", status: "payment_issued", occurred_at: Time.current)
    expect(result[:totals]).to include(issued_hours: 0.0, needs_reconciliation_hours: 8.0, receipt_review_count: 1)
    expect(described_class.new(user: employee).call(period_id: "2026-09-01")[:period][:coverage_lines].first).to include(status: "payment_issued", coverage_state: "receipt_review", receipt_scope: "batch")
  end

  it "credits legacy entry receipts only when their frozen payable line is unambiguous" do
    row = entry(8)
    batch = create(:payroll_batch)
    line(batch, row, 8)
    PayrollEntryProcessingEvent.create!(payroll_batch: batch, source_time_entry_id: row.id, event_id: SecureRandom.uuid,
      source_user_uuid: employee.payroll_integration_uuid, external_system: "cornerstone_payroll", status: "payment_issued", occurred_at: Time.current)
    expect(result[:totals]).to include(issued_hours: 8.0, receipt_review_count: 0)
    line(batch, row, 1, -1, "correction")
    expect(result[:totals]).to include(issued_hours: 0.0, receipt_review_count: 2, needs_reconciliation_hours: 8.0)
  end

  it "rejects invalid dates and page sizes" do
    expect { result(start_date: "wrong") }.to raise_error(ArgumentError, /YYYY-MM-DD/)
    expect { result(per_page: 0) }.to raise_error(ArgumentError, /per_page/)
    expect { result(end_date: "2026-01-01", start_date: "2026-02-01") }.to raise_error(ArgumentError, /on or after/)
  end

  it "separates the exact noncash correction from committed-unissued coverage without rewriting the paid source" do
    source = entry(3)
    original = create(:payroll_batch)
    old = line(original, source, 4)
    paid = receipt(original, old, "payment_issued")
    correction = create(:payroll_batch, start_date: Date.new(2026, 10, 1), end_date: Date.new(2026, 10, 15))
    delta = line(correction, source, -1, 0, "correction")
    PayrollEntryProcessingEvent.create!(payroll_batch: correction, source_time_entry_id: source.id, source_user_uuid: employee.payroll_integration_uuid,
      contract_version: "2.0", source_line_key: delta.line_key, source_kind: "correction", total_hours: -1, regular_hours: -1, overtime_hours: 0,
      event_id: SecureRandom.uuid, external_system: "cornerstone_payroll", external_pay_period_id: "44", external_payroll_item_id: "55", status: "committed", occurred_at: Time.current,
      metadata: { "accounting_only" => true, "correction_disposition_id" => "9", "original_pay_period_id" => "10", "original_payroll_item_id" => "11", "corrective_pay_period_id" => "44", "corrective_payroll_item_id" => "55" })
    detail = described_class.new(user: employee).call(period_id: "2026-09-01")[:period]
    expect(detail[:summary]).to include(issued_hours: 4.0, committed_hours: 0.0, accounting_correction_hours: -1.0, accounting_correction_line_count: 1, unissued_correction_count: 0)
    expect(detail[:coverage_lines]).to include(include(source_line_key: delta.line_key, accounting_only: true, status: "committed", total_hours: -1.0))
    expect(paid.reload.status).to eq("payment_issued")
    expect(detail[:amount_owed]).to be_nil
  end
end
