# frozen_string_literal: true

require "rails_helper"

RSpec.describe "TimeEntryClockAnomalyReport" do
  let(:observed_at) { Time.iso8601("2026-10-24T03:00:00Z") }

  def clock(span:, saved:, break_minutes: 0)
    start = observed_at - 3.days
    entry = create(:time_entry, entry_method: "clock", clock_in_at: start, clock_out_at: start + 2.hours,
      start_time: start, end_time: start + 2.hours, approval_status: "approved")
    entry.update_columns(clock_out_at: start + span.hours, hours: saved, break_minutes: break_minutes)
    entry.reload
  end

  def report
    TimeEntryClockAnomalyReport.new(observed_at: observed_at).each_row.to_a
  end

  it "includes the exact 24h boundary and the exact 1h discrepancy boundary, subtracting breaks" do
    long = clock(span: 24, saved: 0)
    discrepancy = clock(span: 8, saved: 6.5, break_minutes: 30)
    normal = clock(span: 8, saved: 7.5, break_minutes: 30)
    near = clock(span: 8, saved: 6.51, break_minutes: 30)
    rows = report.index_by { |row| row[:id] }
    expect(rows.keys).to contain_exactly(long.id, discrepancy.id)
    expect(rows.fetch(long.id)).to include(actual_elapsed_hours: 24.0, flags: %w[elapsed_at_least_24h saved_hours_discrepancy])
    expect(rows.fetch(discrepancy.id)).to include(net_elapsed_hours: 7.5, saved_hours: 6.5, hours_difference: -1.0)
    expect(rows.keys).not_to include(normal.id, near.id)
  end

  it "reports open long clocks against one observed time without treating unfinished saved hours as a discrepancy" do
    entry = clock(span: 2, saved: 0)
    entry.update_columns(clock_in_at: observed_at - 24.hours, clock_out_at: nil, status: "clocked_in")
    expect(report.sole).to include(id: entry.id, span_basis: "open_as_of_report", actual_elapsed_hours: 24.0,
      net_elapsed_hours: nil, hours_difference: nil, flags: [ "elapsed_at_least_24h" ])
  end

  it "detects overstatements and impossible break totals, excluding manual or missing-punch records" do
    overstated = clock(span: 8, saved: 9)
    impossible_breaks = clock(span: 2, saved: 0, break_minutes: 180)
    manual = clock(span: 26, saved: 2)
    manual.update_columns(entry_method: "manual")
    missing_punch = clock(span: 26, saved: 2)
    missing_punch.update_columns(clock_in_at: nil)
    rows = report.index_by { |row| row[:id] }
    expect(rows.keys).to contain_exactly(overstated.id, impossible_breaks.id)
    expect(rows.fetch(overstated.id)).to include(hours_difference: 1.0)
    expect(rows.fetch(impossible_breaks.id)).to include(net_elapsed_hours: -1.0, hours_difference: 1.0)
  end

  it "includes export and payment evidence without writing any source, export, receipt, revision or outbox record" do
    entry = clock(span: 26, saved: 2)
    export = ReportExport.create!(export_type: "detailed_entries_csv", readiness_status: "complete", start_date: entry.work_date,
      end_date: entry.work_date, checksum: "legacy", generated_at: observed_at, last_downloaded_at: observed_at,
      entry_ids: [ entry.id ], protects_entries: true)
    batch = create(:payroll_batch)
    batch.payroll_batch_entries.create!(source_time_entry_id: entry.id, source_user_id: entry.user_id, work_date: entry.work_date,
      week_start: entry.work_date.beginning_of_week(:sunday), source_kind: "current", line_key: "legacy", total_hours: 2, regular_hours: 2, overtime_hours: 0)
    receipt = PayrollEntryProcessingEvent.create!(payroll_batch: batch, event_id: SecureRandom.uuid, source_time_entry_id: entry.id,
      status: "payment_issued", external_system: "cornerstone_payroll", occurred_at: observed_at)
    source_facts = entry.attributes.slice("hours", "approval_status", "clock_in_at", "clock_out_at")
    receipt_facts = receipt.attributes
    entry.update!(description: "Receipt reconciliation note", overtime_status: "pending")
    expect(entry.reload.attributes.slice(*source_facts.keys)).to eq(source_facts)
    expect(receipt.reload.attributes).to eq(receipt_facts)
    original = entry.attributes
    writes = []
    subscriber = ->(_name, _start, _finish, _id, payload) { writes << payload[:sql] if payload[:sql].match?(/\A\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i) }
    rows = ActiveSupport::Notifications.subscribed(subscriber, "sql.active_record") { report }
    expect(writes).to be_empty
    expect(entry.reload.attributes).to eq(original)
    expect(rows.sole).to include(user: { id: entry.user_id, name: entry.user.full_name }, approval_status: "approved", payroll_status: "payment_issued")
    expect(rows.sole[:exports]).to include(include(public_id: export.public_id, state: "active", protects_entries: true))
    expect(rows.sole[:settlements]).to include(include(batch_id: batch.public_id, status: "payment_issued", paid_hours: 2.0))
  end
end
