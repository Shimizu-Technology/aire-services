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

  def line(batch, row, regular, overtime = 0, kind = "current", snapshot: {})
    batch.payroll_batch_entries.create!(source_time_entry_id: row.id, source_user_id: employee.id, source_user_uuid: employee.payroll_integration_uuid, source_category_id: row.time_category_id,
      work_date: row.work_date, week_start: row.work_date.beginning_of_week(:sunday), line_key: SecureRandom.uuid, source_kind: kind,
      regular_hours: regular, overtime_hours: overtime, total_hours: regular + overtime, snapshot: snapshot)
  end

  def receipt(batch, row, status, **attributes)
    PayrollEntryProcessingEvent.create!(payroll_batch: batch, source_time_entry_id: row.source_time_entry_id,
      source_user_uuid: employee.payroll_integration_uuid, contract_version: "2.0", source_line_key: row.line_key, source_kind: row.source_kind,
      regular_hours: row.regular_hours, overtime_hours: row.overtime_hours, total_hours: row.total_hours,
      event_id: SecureRandom.uuid, external_system: "cornerstone_payroll", external_pay_period_id: "destination", external_payroll_item_id: "item-1", status: status, occurred_at: Time.current, **attributes)
  end

  def included_case(source, origin, included, reason, version: source.lock_version)
    create(:payroll_settlement_case, origin_payroll_batch: origin, included_payroll_batch: included,
      source_time_entry_id: source.id, source_time_entry_version: version, source_user_id: employee.id,
      source_user_uuid: employee.payroll_integration_uuid, original_work_date: source.work_date,
      origin_reason: reason, status: "in_payroll", destination_kind: "supplemental", target_external_pay_period_id: "destination")
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
    paid = receipt(original, old, "payment_issued", external_pay_period_id: "10", external_payroll_item_id: "11", payment_method: "paper_check", payment_reference: "30000")
    correction = create(:payroll_batch, start_date: Date.new(2026, 10, 1), end_date: Date.new(2026, 10, 15))
    delta = line(correction, source, -1, 0, "correction", snapshot: { "version" => source.lock_version })
    PayrollEntryProcessingEvent.create!(payroll_batch: correction, source_time_entry_id: source.id, source_user_uuid: employee.payroll_integration_uuid,
      contract_version: "2.0", source_line_key: delta.line_key, source_kind: "correction", total_hours: -1, regular_hours: -1, overtime_hours: 0,
      event_id: SecureRandom.uuid, external_system: "cornerstone_payroll", external_pay_period_id: "44", external_payroll_item_id: "55", status: "committed", occurred_at: Time.current,
      metadata: { "accounting_only" => true, "correction_disposition_id" => "9", "original_pay_period_id" => "10", "original_payroll_item_id" => "11", "corrective_pay_period_id" => "44", "corrective_payroll_item_id" => "55" })
    historical = included_case(source, original, correction, "changed_after_cutoff")
    before = historical.attributes.deep_dup
    detail = described_class.new(user: employee).call(period_id: "2026-09-01")[:period]
    expect(detail[:summary]).to include(issued_hours: 4.0, committed_hours: 0.0, accounting_correction_hours: -1.0, accounting_correction_line_count: 1, unissued_correction_count: 0)
    expect(detail[:coverage_lines]).to include(include(source_line_key: delta.line_key, accounting_only: true, status: "committed", total_hours: -1.0))
    expect(paid.reload.status).to eq("payment_issued")
    expect(detail[:amount_owed]).to be_nil
    expect(detail).to include(review_required: false)
    expect(detail[:summary][:open_case_count]).to eq(1)
    expect(historical.reload.attributes).to eq(before)
    expect(detail[:settlement_cases].first).to include("status" => "in_payroll", "accounting_only" => true, "completion" => "accounting_recorded", "target_pay_date" => nil)
  end

  context "with retained ordinary carryover case history" do
    let(:source) { entry(4) }
    let(:origin) { create(:payroll_batch) }
    let(:included) { create(:payroll_batch, start_date: Date.new(2026, 10, 1), end_date: Date.new(2026, 10, 15)) }
    let(:frozen) { line(included, source, 4, 0, "carryover", snapshot: { "version" => source.lock_version }) }
    let(:historical) { included_case(source, origin, included, "created_after_cutoff") }
    let(:paid) { receipt(included, frozen, "payment_issued", payment_method: "paper_check", payment_reference: "30001") }

    it "does not serialize discarded case detail when listing work periods" do
      historical
      expect(Payroll::SettlementCaseSerializer).not_to receive(:new)
      evidence = result
      expect(evidence[:totals][:open_case_count]).to eq(1)
      expect(evidence[:periods].first).to include(review_required: true)
      expect(evidence[:periods].first).not_to have_key(:settlement_cases)
    end

    it "shows paid late-created work without an unresolved-period warning and preserves case history" do
      paid
      before = historical.attributes.deep_dup
      evidence = result
      expect(evidence[:periods].first).to include(review_required: false)
      expect(evidence[:totals]).to include(issued_hours: 4.0, needs_reconciliation_hours: 0.0, open_case_count: 1)
      expect(historical.reload.attributes).to eq(before)
      expect(evidence).to include(amount_owed: nil)
      detail = described_class.new(user: employee).call(period_id: "2026-09-01")[:period]
      expect(detail[:settlement_cases].sole).to include("status" => "in_payroll", "completion" => "paid", "target_pay_date" => nil)
    end

    it "reads the named regular calendar payday separately from the recorded follow-up date" do
      paid
      calendar = create(:payroll_calendar_period, external_pay_period_id: "destination", start_date: Date.new(2026, 10, 1), end_date: Date.new(2026, 10, 15), pay_date: Date.new(2026, 11, 10))
      historical.update!(destination_kind: "regular", target_payroll_calendar_period: calendar, action_due_on: Date.new(2026, 11, 5))
      before = historical.attributes.deep_dup
      detail = described_class.new(user: employee).call(period_id: "2026-09-01")[:period]
      expect(detail[:settlement_cases].sole).to include("completion" => "paid", "target_pay_date" => "2026-11-10", "action_due_on" => Date.new(2026, 11, 5), "target_external_pay_period_id" => "destination")
      expect(historical.reload.attributes).to eq(before)
    end

    it "recognizes an approved version carried from the earlier pending cutoff case" do
      captured_version = source.lock_version
      source.update!(end_time: source.start_time + 4.hours, approval_status: "approved", approved_by: employee, approved_at: Time.current)
      expect(source.lock_version).to be > captured_version
      paid
      earlier = included_case(source, origin, included, "pending_approval", version: captured_version)
      before = earlier.attributes.deep_dup
      expect(result[:periods].first).to include(review_required: false)
      expect(earlier.reload.attributes).to eq(before)
    end

    %w[missing prepared failed cancelled legacy uuid hours source_version case_version missing_snapshot ambiguous instrument].each do |defect|
      it "keeps #{defect} carryover processing evidence requiring review" do
        historical
        case defect
        when "missing" then frozen
        when "prepared" then receipt(included, frozen, "payment_prepared", payment_method: "paper_check", payment_reference: "30001")
        when "failed" then receipt(included, frozen, "payment_failed", payment_method: "paper_check", payment_reference: "30001")
        when "cancelled" then receipt(included, frozen, "payment_cancelled", payment_method: "paper_check", payment_reference: "30001")
        when "legacy"
          PayrollEntryProcessingEvent.create!(payroll_batch: included, source_time_entry_id: frozen.source_time_entry_id,
            source_user_uuid: employee.payroll_integration_uuid, event_id: SecureRandom.uuid, external_system: "cornerstone_payroll",
            external_pay_period_id: "destination", external_payroll_item_id: "item-1", status: "payment_issued", occurred_at: Time.current,
            payment_method: "paper_check", payment_reference: "30001")
        when "uuid" then receipt(included, frozen, "payment_issued", source_user_uuid: SecureRandom.uuid)
        when "hours" then receipt(included, frozen, "payment_issued", regular_hours: 3, total_hours: 3)
        when "source_version"
          paid
          source.update!(description: "Later source revision requiring a new review")
        when "case_version"
          paid
          historical.update!(source_time_entry_version: source.lock_version + 1)
        when "missing_snapshot"
          receipt(included, line(included, source, 4, 0, "carryover"), "payment_issued", payment_method: "paper_check", payment_reference: "30001")
        when "ambiguous"
          paid
          line(included, source, 1, 0, "carryover", snapshot: { "version" => source.lock_version })
        when "instrument" then receipt(included, frozen, "payment_issued")
        end
        expect(result[:periods].first).to include(review_required: true)
        detail = described_class.new(user: employee).call(period_id: "2026-09-01")[:period]
        expect(detail[:settlement_cases].sole).to include("completion" => nil)
        expect(historical.reload.status).to eq("in_payroll")
        expect(historical.resolved_at).to be_nil
      end
    end
  end

  context "with an issued positive OT correction from an earlier pending overtime case" do
    let(:defect) { RSpec.current_example.metadata[:defect] }
    let(:source) { entry(10, Date.new(2026, 9, 12)) }
    let(:origin) { create(:payroll_batch) }
    let(:included) { create(:payroll_batch, start_date: Date.new(2026, 10, 1), end_date: Date.new(2026, 10, 15), cutoff_at: Time.utc(2026, 10, 18)) }
    let(:original_line) do
      version = { "original_version_negative" => -1, "original_version_string" => "0", "original_version_missing" => nil }.fetch(defect, 0)
      line(origin, source, 8, 0, "current", snapshot: { "version" => version })
    end
    let(:delta) do
      regular, overtime = defect == "wrong_split" ? [ 2, 0 ] : [ 0, defect == "partial_delta" ? 1 : 2 ]
      frozen_source = defect == "wrong_date" ? entry(10, source.work_date + 1) : source
      row = line(included, frozen_source, regular, overtime, "correction", snapshot: defect == "missing_version" ? {} : { "version" => source.lock_version })
      row
    end
    let(:historical) { included_case(source, origin, included, "pending_overtime", version: 0) }

    before do
      source.update_columns(lock_version: 1, overtime_status: "approved")
      source.reload
      original_line
      source.update_columns(time_category_id: create(:time_category).id) if defect == "wrong_category"
      4.times do |offset|
        previous = entry(8, Date.new(2026, 9, 8) + offset)
        receipt(origin, line(origin, previous, 8, 0, "current", snapshot: { "version" => previous.lock_version }),
          "payment_issued", payment_method: "paper_check", payment_reference: "30000")
      end
      original_line
      unless defect == "original_missing"
        if defect == "original_legacy"
          legacy_positive_receipt(origin)
        else
          receipt(origin, original_line, "payment_issued", payment_method: "paper_check", payment_reference: "30000")
        end
      end
      if defect == "delta_legacy"
        delta
        legacy_positive_receipt(included)
      else
        receipt(included, delta, "payment_issued", payment_method: "paper_check", payment_reference: "30004")
      end
      historical
    end

    def legacy_positive_receipt(batch)
      PayrollEntryProcessingEvent.create!(payroll_batch: batch, source_time_entry_id: source.id, source_user_uuid: employee.payroll_integration_uuid,
        event_id: SecureRandom.uuid, external_system: "cornerstone_payroll", external_pay_period_id: "destination", external_payroll_item_id: "item-1",
        status: "payment_issued", occurred_at: Time.current, payment_method: "paper_check", payment_reference: "30004")
    end

    it "recognizes original 40 REG plus issued 2 OT without closing or rewriting the retained case" do
      before = [ source.attributes.deep_dup, historical.attributes.deep_dup, original_line.attributes.deep_dup, delta.attributes.deep_dup ]
      Payroll::IntegrationProfile.call # Initialize installation identity before the read-only assertion.
      writes = []
      subscriber = ->(*args) { writes << args.last[:sql] if args.last[:sql].match?(/\A\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i) }
      evidence = ActiveSupport::Notifications.subscribed(subscriber, "sql.active_record") { result }
      expect(evidence[:periods].sole).to include(review_required: false)
      expect(evidence[:totals]).to include(worked_hours: 42.0, current_regular_hours: 40.0, current_overtime_hours: 2.0,
        issued_hours: 42.0, needs_reconciliation_hours: 0.0, open_case_count: 1)
      expect([ source.reload.attributes, historical.reload.attributes, original_line.reload.attributes, delta.reload.attributes ]).to eq(before)
      expect(writes).to be_empty
      detail = described_class.new(user: employee).call(period_id: "2026-09-01")[:period]
      expect(detail[:settlement_cases].sole).to include("completion" => "paid", "target_pay_date" => nil, "status" => "in_payroll")
    end

    it "projects the paid positive correction as retained queue history rather than unfinished payroll" do
      origin.payroll_batch_exclusions.create!(source_time_entry_id: source.id, source_user_id: employee.id,
        reason: "pending_overtime", held_total_hours: 2, held_regular_hours: 0, held_overtime_hours: 2, snapshot: { "version" => 0 })
      evidence = Payroll::CarryoverQueue.new.call
      expect(evidence[:items].sole).to include(status: "payment_issued", completion: "paid", exclusion_reason: "pending_overtime")
      expect(evidence[:summary]).to include(in_payroll_count: 0, unresolved_count: 0, paid_count: 1)
      expect(historical.reload.status).to eq("in_payroll")
    end

    it "also requires exact positive coverage when the retained case originated from a post-cutoff change" do
      historical.update!(origin_reason: "changed_after_cutoff", source_time_entry_version: 1)
      expect(result[:periods].sole).to include(review_required: false)
    end

    %w[original_version_negative original_version_string original_version_missing original_cancelled delta_cancelled original_missing original_legacy delta_legacy foreign_system foreign_uuid stale_version future_case_version missing_version ambiguous_original ambiguous_delta wrong_category wrong_date wrong_split partial_delta pending_ot evidence_hold].each do |defect|
      it "retains attention for #{defect} despite a nominal issued positive correction", defect: defect do
        case defect
        when "original_cancelled" then receipt(origin, original_line, "payment_cancelled", payment_method: "paper_check", payment_reference: "30000")
        when "delta_cancelled" then receipt(included, delta, "payment_cancelled", payment_method: "paper_check", payment_reference: "30004")
        when "foreign_system" then receipt(included, delta, "payment_issued", external_system: "foreign_payroll", payment_method: "paper_check", payment_reference: "30004")
        when "foreign_uuid" then receipt(included, delta, "payment_issued", source_user_uuid: SecureRandom.uuid, payment_method: "paper_check", payment_reference: "30004")
        when "stale_version" then source.update!(description: "Changed after issuance")
        when "future_case_version" then historical.update!(source_time_entry_version: 2)
        when "ambiguous_original" then line(origin, source, 1)
        when "ambiguous_delta" then line(included, source, 1, 0, "correction", snapshot: { "version" => 1 })
        when "pending_ot" then source.update_columns(overtime_status: "pending")
        when "evidence_hold"
          PayrollPaymentAttestation.create!(time_entry: source, user: employee, recorded_by: employee, source_user_uuid: employee.payroll_integration_uuid,
            source_time_entry_version: 1, work_date: source.work_date, hours: 2, reason: "Missing original check evidence", attested_at: Time.current)
        end
        expect(result[:periods].sole).to include(review_required: true)
        detail = described_class.new(user: employee).call(period_id: "2026-09-01")[:period]
        expect(detail[:settlement_cases].sole).to include("completion" => nil)
        expect(historical.reload.status).to eq("in_payroll")
      end
    end
  end

  context "with a retained accounting correction case" do
    let(:source) { entry(3) }
    let(:origin) { create(:payroll_batch) }
    let(:included) { create(:payroll_batch, start_date: Date.new(2026, 10, 1), end_date: Date.new(2026, 10, 15)) }
    let(:delta) { line(included, source, -1, 0, "correction", snapshot: { "version" => source.lock_version }) }
    let(:historical) { included_case(source, origin, included, "changed_after_cutoff") }
    let(:metadata) do
      { "accounting_only" => true, "correction_disposition_id" => "9", "original_pay_period_id" => "10",
        "original_payroll_item_id" => "11", "corrective_pay_period_id" => "44", "corrective_payroll_item_id" => "55" }
    end

    let(:original_line) { line(origin, source, 4) }
    let(:original_paid) do
      receipt(origin, original_line, "payment_issued", external_pay_period_id: "10", external_payroll_item_id: "11", payment_method: "paper_check", payment_reference: "30000")
    end
    let(:accounting_receipt) { receipt(included, delta, "committed", external_pay_period_id: "44", external_payroll_item_id: "55", metadata: metadata) }

    it "keeps attention after the original payment is cancelled even with zero remaining source hours" do
      original_paid
      accounting_receipt
      before = historical.attributes.deep_dup
      cancellation = receipt(origin, original_line, "payment_cancelled", external_pay_period_id: "10", external_payroll_item_id: "11",
        payment_method: "paper_check", payment_reference: "30000", occurred_at: Time.current + 1.second)
      # A delayed old issuance cannot undo the cancellation tombstone.
      receipt(origin, original_line, "payment_issued", external_pay_period_id: "10", external_payroll_item_id: "11",
        payment_method: "paper_check", payment_reference: "30000", occurred_at: Time.current + 2.seconds)
      evidence = result
      expect(evidence[:periods].first).to include(review_required: true)
      expect(evidence[:totals]).to include(needs_reconciliation_hours: 0.0, accounting_correction_hours: -1.0, issued_hours: 0.0)
      expect(evidence).to include(amount_owed: nil)
      expect(historical.reload.attributes).to eq(before)
      expect(original_paid.reload.status).to eq("payment_issued")
      expect(cancellation.reload.status).to eq("payment_cancelled")
      expect(accounting_receipt.reload.status).to eq("committed")
    end

    it "recognizes a fresh exact original replacement while retaining cancellation history" do
      original_paid
      accounting_receipt
      before = historical.attributes.deep_dup
      cancellation = receipt(origin, original_line, "payment_cancelled", external_pay_period_id: "10", external_payroll_item_id: "11",
        payment_method: "paper_check", payment_reference: "30000", occurred_at: Time.current + 1.second)
      receipt(origin, original_line, "payment_issued", external_pay_period_id: "10", external_payroll_item_id: "11",
        payment_method: "paper_check", payment_reference: "30002", occurred_at: Time.current + 2.seconds)
      expect(result[:periods].first).to include(review_required: false)
      expect(result[:totals]).to include(issued_hours: 4.0, accounting_correction_hours: -1.0)
      expect(cancellation.reload.status).to eq("payment_cancelled")
      expect(historical.reload.attributes).to eq(before)
    end

    %w[missing prepared failed legacy uuid hours destination instrument ambiguous].each do |defect|
      it "requires exact current original payment evidence when #{defect}" do
        accounting_receipt
        before = historical.attributes.deep_dup
        attributes = { external_pay_period_id: "10", external_payroll_item_id: "11", payment_method: "paper_check", payment_reference: "30000" }
        attributes[:source_user_uuid] = SecureRandom.uuid if defect == "uuid"
        attributes.merge!(total_hours: 3, regular_hours: 3) if defect == "hours"
        attributes[:external_payroll_item_id] = "12" if defect == "destination"
        attributes[:payment_reference] = nil if defect == "instrument"
        status = { "prepared" => "payment_prepared", "failed" => "payment_failed" }.fetch(defect, "payment_issued")
        if defect == "legacy"
          PayrollEntryProcessingEvent.create!(payroll_batch: origin, source_time_entry_id: original_line.source_time_entry_id,
            source_user_uuid: employee.payroll_integration_uuid, event_id: SecureRandom.uuid, external_system: "cornerstone_payroll",
            status: "payment_issued", occurred_at: Time.current, **attributes)
        elsif defect == "missing"
          original_line
          # Non-exact batch evidence cannot prove this original instrument.
          PayrollBatchProcessingEvent.create!(payroll_batch: origin, event_id: SecureRandom.uuid, external_system: "cornerstone_payroll", status: "payment_issued", occurred_at: Time.current)
        else
          receipt(origin, original_line, status, **attributes)
        end
        if defect == "ambiguous"
          extra = line(origin, source, 4)
          receipt(origin, extra, "payment_issued", **attributes)
        end
        expect(result[:periods].first).to include(review_required: true)
        expect(historical.reload.attributes).to eq(before)
        expect(accounting_receipt.reload.status).to eq("committed")
      end
    end

    %w[missing prepared failed cancelled stale_source stale_case uuid metadata].each do |defect|
      it "does not dismiss #{defect} accounting correction evidence as confirmed processing" do
        receipt(origin, line(origin, source, 4), "payment_issued", external_pay_period_id: "10", external_payroll_item_id: "11", payment_method: "paper_check", payment_reference: "30000")
        historical
        attributes = { external_pay_period_id: "44", external_payroll_item_id: "55", metadata: metadata }
        status = { "prepared" => "payment_prepared", "failed" => "payment_failed", "cancelled" => "payment_cancelled" }.fetch(defect, "committed")
        attributes[:source_user_uuid] = SecureRandom.uuid if defect == "uuid"
        attributes[:metadata] = metadata.merge("recovered" => true) if defect == "metadata"
        if defect == "missing"
          delta
        else
          receipt(included, delta, status, **attributes)
        end
        source.update!(end_time: source.start_time + 3.hours, description: "Later revision") if defect == "stale_source"
        historical.update!(source_time_entry_version: source.lock_version + 1) if defect == "stale_case"
        before = historical.reload.attributes.deep_dup
        evidence = result
        expect(evidence[:periods].first).to include(review_required: true)
        expect(evidence[:totals][:needs_reconciliation_hours]).to eq(0.0)
        expect(evidence).to include(amount_owed: nil)
        expect(historical.reload.attributes).to eq(before)
      end
    end
  end
end
