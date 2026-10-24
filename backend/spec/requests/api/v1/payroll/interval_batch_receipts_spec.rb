# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Interval batch history and receipts", type: :request do
  let(:admin) { create(:user, :admin) }
  let(:user) { create(:user, :employee) }
  let(:category) { create(:time_category) }
  let(:zone) { ActiveSupport::TimeZone["Pacific/Guam"] }
  let(:secret) { "interval-batch-receipts-test-secret" }

  around do |example|
    previous = ENV["PAYROLL_SHARED_SECRET"]
    ENV["PAYROLL_SHARED_SECRET"] = secret
    example.run
  ensure
    ENV["PAYROLL_SHARED_SECRET"] = previous
  end

  def overnight
    @overnight ||= create(:time_entry, user: user, time_category: category,
      work_date: Date.new(2026, 10, 17), entry_method: "clock", status: "completed", approval_status: nil,
      start_time: zone.parse("2026-10-17 22:00"), end_time: zone.parse("2026-10-18 02:00"),
      clock_in_at: zone.parse("2026-10-17 22:00"), clock_out_at: zone.parse("2026-10-18 02:00"))
  end

  def finalize
    overnight
    Payroll::BatchFinalizer.new(start_date: "2026-10-16", end_date: "2026-10-31", actor: admin).call
  end

  def receipt(batch, line)
    event = { event_id: "interval-issued-#{line.id}", source_time_entry_id: line.source_time_entry_id.to_s,
      source_user_uuid: user.payroll_integration_uuid, status: "payment_issued", occurred_at: Time.current.iso8601(6),
      external_system: "cornerstone_payroll", external_pay_period_id: "interval-42", external_payroll_item_id: "91",
      contract_version: "2.0", source_line_key: line.line_key, source_kind: line.source_kind,
      total_hours: line.total_hours.to_s, regular_hours: line.regular_hours.to_s, overtime_hours: line.overtime_hours.to_s,
      payment_method: "paper_check", payment_reference: "SYNTHETIC-42" }
    2.times do |i|
      expect do
        post "/api/v1/payroll/batches/#{batch.public_id}/processing_events", params: event,
          headers: { "X-Payroll-Shared-Secret" => ENV.fetch("PAYROLL_SHARED_SECRET") }
      end.to change(PayrollEntryProcessingEvent, :count).by(i.zero? ? 1 : 0)
      expect(response).to have_http_status(i.zero? ? :created : :ok)
    end
  end

  def frozen_bytes(batch)
    connection = ApplicationRecord.connection
    [ connection.select_value("SELECT payload::text FROM payroll_batches WHERE id = #{batch.id}"), batch.reload.checksum,
      connection.select_values("SELECT row_to_json(e)::text FROM payroll_entry_processing_events e WHERE payroll_batch_id = #{batch.id} ORDER BY id") ]
  end

  it "accepts and replays independent exact receipts for both payable lines of one entry" do
    batch = finalize
    lines = batch.payroll_batch_entries.order(:work_date).to_a
    expect(lines.map(&:source_time_entry_id)).to eq([ overnight.id, overnight.id ])
    expect(lines.map(&:total_hours)).to eq([ 2, 2 ])
    expect(lines.map(&:line_key).uniq.size).to eq(2)
    lines.each { |line| receipt(batch, line) }
    expect(PayrollEntryProcessingEvent.sum(:total_hours)).to eq(4)
  end

  it "records a signed correction against frozen overnight dimensions after current approval" do
    batch = finalize
    batch.payroll_batch_entries.each { |line| receipt(batch, line) }
    original = frozen_bytes(batch)
    overnight.update!(end_time: zone.parse("2026-10-18 01:00"), clock_out_at: zone.parse("2026-10-18 01:00"), approval_status: "pending")
    TimeClockService.approve_entry(entry: overnight, approved_by: admin)
    result = Payroll::BatchBuilder.new(start_date: "2026-11-01", end_date: "2026-11-15").call
    expect(result[:rows]).to contain_exactly(include(source_time_entry_id: overnight.id, work_date: Date.new(2026, 10, 18),
      total_hours: -1, regular_hours: -1, overtime_hours: 0, source_kind: "correction"))
    expect(frozen_bytes(batch)).to eq(original)
  end

  it "keeps old batch bytes, checksum, labels and issued receipts identical across migration and later unrelated edits" do
    # Build the old scalar contract, then rehearse the actual migration against
    # a populated pre-upgrade schema inside this example's rollback transaction.
    allow_any_instance_of(Payroll::BatchBuilder).to receive(:allocation_contract_version).and_return(nil)
    batch = finalize
    batch.payroll_batch_entries.each { |line| receipt(batch, line) }
    original = frozen_bytes(batch)
    labels = batch.payroll_batch_entries.pluck(:line_key, :work_date)
    connection = ApplicationRecord.connection
    connection.execute("DROP TRIGGER time_entry_breaks_capture_payroll_revision ON time_entry_breaks")
    connection.execute("DROP FUNCTION capture_payroll_break_revision()")
    old_migration = Rails.root.join("db/migrate/20260930020000_create_payroll_time_entry_revisions.rb").read
    old_function = old_migration.split("      CREATE OR REPLACE FUNCTION capture_payroll_time_entry_revision()", 2).last.split("      -- Keep the backfill", 2).first
    connection.execute("CREATE OR REPLACE FUNCTION capture_payroll_time_entry_revision()" + old_function)
    connection.remove_column(:payroll_batches, :allocation_contract_version)
    connection.remove_column(:time_entries, :overtime_allocation_signature)
    connection.remove_column(:time_entries, :allocation_contract_version)
    connection.execute("UPDATE time_entries SET updated_at = updated_at WHERE id = #{overnight.id}")
    pre_upgrade_cutoff = connection.select_value("SELECT clock_timestamp()")
    load Rails.root.join("db/migrate/20261024010000_capture_payable_interval_chronology.rb")
    ActiveRecord::Migration.suppress_messages { CapturePayableIntervalChronology.new.up }
    [ TimeEntry, PayrollBatch, PayrollCalendarPeriod ].each(&:reset_column_information)
    expect(frozen_bytes(batch)).to eq(original)
    expect(batch.payroll_batch_entries.pluck(:line_key, :work_date)).to eq(labels)
    old_state = Payroll::TimeEntryRevisionLedger.new(cutoff_at: pre_upgrade_cutoff).entries_for_ids([ overnight.id ]).sole
    expect(Payroll::WeeklyOvertimeAllocator.call([ old_state ]).fetch(overnight.id))
      .to include(hold_reason: "missing_break_chronology")
    overnight.reload.update!(description: "Unrelated post-upgrade note")
    create(:time_entry, user: user, time_category: category, work_date: Date.new(2026, 10, 20))
    expect(frozen_bytes(batch)).to eq(original)
    expect(batch.payroll_batch_entries.pluck(:line_key, :work_date)).to eq(labels)
    allow_any_instance_of(Payroll::BatchBuilder).to receive(:allocation_contract_version).and_call_original
    later = Payroll::BatchBuilder.new(start_date: "2026-11-01", end_date: "2026-11-15").call
    expect(later[:rows].select { |row| row[:source_time_entry_id] == overnight.id }).to be_empty
    expect(later[:exclusions]).to include(include(source_time_entry_id: overnight.id,
      snapshot: include("allocation_hold" => "legacy_allocation_requires_review")))
  ensure
    [ TimeEntry, PayrollBatch, PayrollCalendarPeriod ].each(&:reset_column_information)
  end
end
