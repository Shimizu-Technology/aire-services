# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::BatchFinalizer do
  include ActiveSupport::Testing::TimeHelpers

  let(:admin) { create(:user, :admin, first_name: "Payroll", last_name: "Admin") }
  let(:employee) { create(:user, :employee, first_name: "Alice", last_name: "Pilot") }
  let(:category) { create(:time_category, name: "Flight Instruction", hourly_rate_cents: 3_500) }
  let(:guam) { ActiveSupport::TimeZone[TimeClockService::BUSINESS_TIMEZONE] }

  def create_entry(date:, hours: 8, approval_status: nil, overtime_status: "none", created_at: nil)
    attributes = {
      user: employee,
      time_category: category,
      work_date: date,
      start_time: guam.local(date.year, date.month, date.day, 8),
      end_time: guam.local(date.year, date.month, date.day, 8) + hours.hours,
      hours: hours,
      status: "completed",
      approval_status: approval_status,
      overtime_status: overtime_status
    }
    attributes[:created_at] = created_at if created_at
    create(:time_entry, **attributes)
  end

  def finalize(start_date:, end_date:, **options)
    described_class.new(
      start_date: start_date,
      end_date: end_date,
      actor: admin,
      **options
    ).call
  end

  it "finalizes only approved work while preserving pending, denied, and open records as exclusions" do
    travel_to(guam.local(2026, 5, 16, 9)) do
      included = create_entry(date: Date.new(2026, 5, 5))
      pending = create_entry(date: Date.new(2026, 5, 6), approval_status: "pending")
      denied = create_entry(date: Date.new(2026, 5, 7), approval_status: "denied")
      open_entry = create_entry(date: Date.new(2026, 5, 8))
      open_entry.update_columns(status: "clocked_in", end_time: nil, hours: 0)

      batch = finalize(start_date: "2026-05-01", end_date: "2026-05-15")

      expect(batch.payroll_batch_entries.pluck(:source_time_entry_id)).to eq([ included.id ])
      expect(batch.payroll_batch_exclusions.pluck(:source_time_entry_id, :reason)).to contain_exactly(
        [ pending.id, "pending_approval" ],
        [ denied.id, "denied_approval" ],
        [ open_entry.id, "open_clock" ]
      )
      expect(batch.summary).to include("total_hours" => 8.0, "exclusion_count" => 3)
      pending_exclusion = batch.payroll_batch_exclusions.find_by!(source_time_entry_id: pending.id)
      expect(pending_exclusion.held_regular_hours + pending_exclusion.held_overtime_hours)
        .to eq(pending_exclusion.held_total_hours)
      expect(batch.payload.dig("employees", 0, "adjustments", 0, "source_time_entry_id")).to eq(included.id.to_s)
      expect(batch.checksum).to match(/\A[0-9a-f]{64}\z/)
      expect(Payroll::CanonicalPayload.checksum(batch.reload.payload)).to eq(batch.checksum)
      expect(AuditLog.find_by!(action: "payroll_batch.finalized", auditable: batch).metadata)
        .to include("checksum" => batch.checksum)
    end
  end

  it "carries a late approval into the next period without changing the finalized batch" do
    pending = nil
    first_batch = nil
    travel_to(guam.local(2026, 5, 16, 9)) do
      pending = create_entry(date: Date.new(2026, 5, 10), approval_status: "pending")
      first_batch = finalize(start_date: "2026-05-01", end_date: "2026-05-15")
    end

    travel_to(guam.local(2026, 6, 1, 9)) do
      pending.update!(approval_status: "approved", approved_by: admin, approved_at: Time.current)
      next_batch = finalize(start_date: "2026-05-16", end_date: "2026-05-31")
      row = next_batch.payroll_batch_entries.find_by!(source_time_entry_id: pending.id)

      expect(row.source_kind).to eq("carryover")
      expect(row.total_hours.to_f).to eq(8.0)
      expect(first_batch.reload.summary).to include("total_hours" => 0.0, "exclusion_count" => 1)
    end
  end

  it "records a denied carryover once and does not repeat it in later payroll runs" do
    pending = nil
    travel_to(guam.local(2026, 5, 16, 9)) do
      pending = create_entry(date: Date.new(2026, 5, 10), approval_status: "pending")
      finalize(start_date: "2026-05-01", end_date: "2026-05-15")
    end

    travel_to(guam.local(2026, 6, 1, 9)) do
      pending.update!(approval_status: "denied")
      disposition_batch = finalize(start_date: "2026-05-16", end_date: "2026-05-31")
      expect(disposition_batch.payroll_batch_exclusions.pluck(:source_time_entry_id, :reason))
        .to contain_exactly([ pending.id, "denied_approval" ])
    end

    travel_to(guam.local(2026, 6, 16, 9)) do
      later_batch = finalize(start_date: "2026-06-01", end_date: "2026-06-15")
      expect(later_batch.payroll_batch_exclusions).to be_empty
    end
  end

  it "recalculates the whole workweek and carries overtime redistribution forward" do
    pending = nil
    travel_to(guam.local(2026, 5, 11, 9)) do
      pending = create_entry(date: Date.new(2026, 5, 4), approval_status: "pending")
      (Date.new(2026, 5, 5)..Date.new(2026, 5, 9)).each { |date| create_entry(date: date) }
      first_batch = finalize(start_date: "2026-05-01", end_date: "2026-05-10")
      expect(first_batch.summary).to include("regular_hours" => 40.0, "overtime_hours" => 0.0)
    end

    travel_to(guam.local(2026, 5, 25, 9)) do
      pending.update!(approval_status: "approved", approved_by: admin, approved_at: Time.current)
      next_batch = finalize(
        start_date: "2026-05-11",
        end_date: "2026-05-24",
        acknowledge_negative_adjustments: true,
        negative_adjustment_note: "Late approval reallocated the original week's overtime"
      )

      expect(next_batch.summary).to include("total_hours" => 8.0, "regular_hours" => 0.0, "overtime_hours" => 8.0)
      expect(next_batch.payroll_batch_entries.where(source_kind: "correction")).to exist
    end
  end

  it "does not let post-cutoff approvals consume the weekly regular-hours allocation" do
    travel_to(guam.local(2026, 5, 11, 9)) do
      late = create_entry(date: Date.new(2026, 5, 3), approval_status: "approved")
      late.update_columns(approved_at: guam.local(2026, 5, 12, 9))
      legacy_late = create_entry(date: Date.new(2026, 5, 2), approval_status: nil)
      legacy_late.update_columns(approved_at: guam.local(2026, 5, 12, 8))
      (Date.new(2026, 5, 4)..Date.new(2026, 5, 8)).each { |date| create_entry(date: date) }

      batch = finalize(start_date: "2026-05-01", end_date: "2026-05-10")

      expect(batch.summary).to include("total_hours" => 40.0, "regular_hours" => 40.0, "overtime_hours" => 0.0)
      expect(batch.payroll_batch_exclusions.find_by!(source_time_entry_id: late.id).reason).to eq("approved_after_cutoff")
      expect(batch.payroll_batch_exclusions.find_by!(source_time_entry_id: legacy_late.id).reason).to eq("approved_after_cutoff")
    end
  end

  it "requires explicit acknowledgement and a note before finalizing a negative correction" do
    entry = nil
    travel_to(guam.local(2026, 5, 16, 9)) do
      entry = create_entry(date: Date.new(2026, 5, 5))
      finalize(start_date: "2026-05-01", end_date: "2026-05-15")
    end

    travel_to(guam.local(2026, 6, 1, 9)) do
      entry.update!(end_time: entry.end_time - 2.hours)

      expect do
        finalize(start_date: "2026-05-16", end_date: "2026-05-31")
      end.to raise_error(Payroll::BatchFinalizer::FinalizationError, /Negative payroll corrections/)

      batch = finalize(
        start_date: "2026-05-16",
        end_date: "2026-05-31",
        acknowledge_negative_adjustments: true,
        negative_adjustment_note: "Corrected an overstated clock-out"
      )
      correction = batch.payroll_batch_entries.find_by!(source_time_entry_id: entry.id)
      expect(correction.source_kind).to eq("correction")
      expect(correction.total_hours.to_f).to eq(-2.0)
      expect(batch.payload["negative_adjustment_acknowledgement"]).to eq("Corrected an overstated clock-out")
    end
  end

  it "reverses the old category and rate before adding a corrected payroll dimension" do
    entry = nil
    new_category = create(:time_category, name: "Admin Duties", hourly_rate_cents: 2_500)
    travel_to(guam.local(2026, 5, 16, 9)) do
      entry = create_entry(date: Date.new(2026, 5, 5))
      finalize(start_date: "2026-05-01", end_date: "2026-05-15")
    end

    travel_to(guam.local(2026, 6, 1, 9)) do
      entry.update!(time_category: new_category)
      batch = finalize(
        start_date: "2026-05-16",
        end_date: "2026-05-31",
        acknowledge_negative_adjustments: true,
        negative_adjustment_note: "Corrected the work category after manager review"
      )
      corrections = batch.payroll_batch_entries.where(source_time_entry_id: entry.id).order(:total_hours)

      expect(corrections.size).to eq(2)
      expect(corrections.map { |row| [ row.source_category_id, row.effective_rate_cents, row.total_hours.to_f ] }).to contain_exactly(
        [ category.id, 3_500, -8.0 ],
        [ new_category.id, 2_500, 8.0 ]
      )
      expect(batch.summary).to include("total_hours" => 0.0, "adjustment_count" => 2)
    end
  end

  it "uses the audit tombstone to reverse a paid entry deleted after the cutoff" do
    entry = nil
    travel_to(guam.local(2026, 5, 16, 9)) do
      entry = create_entry(date: Date.new(2026, 5, 5))
      finalize(start_date: "2026-05-01", end_date: "2026-05-15")
    end

    travel_to(guam.local(2026, 6, 1, 9)) do
      entry_id = entry.id
      entry.destroy!
      AuditLog.record!(
        action: "time_entry.deleted",
        actor: admin,
        subject_type: "TimeEntry",
        subject_id: entry_id,
        subject_name: "Deleted paid entry",
        event_category: "time_tracking",
        metadata: { correction_reason: "Duplicate paid entry" }
      )

      batch = finalize(
        start_date: "2026-05-16",
        end_date: "2026-05-31",
        acknowledge_negative_adjustments: true,
        negative_adjustment_note: "Reversed a deleted duplicate entry"
      )

      correction = batch.payroll_batch_entries.find_by!(source_time_entry_id: entry_id)
      expect(correction.source_kind).to eq("correction")
      expect(correction.total_hours.to_f).to eq(-8.0)
    end
  end

  it "recalculates both weeks when a previously paid entry moves to a new week" do
    moved = nil
    last_entry = nil
    travel_to(guam.local(2026, 5, 11, 9)) do
      moved = create_entry(date: Date.new(2026, 5, 3))
      (Date.new(2026, 5, 4)..Date.new(2026, 5, 8)).each { |date| last_entry = create_entry(date: date) }
      finalize(start_date: "2026-05-01", end_date: "2026-05-10")
    end

    travel_to(guam.local(2026, 5, 25, 9)) do
      moved.update!(work_date: Date.new(2026, 5, 12))
      batch = finalize(
        start_date: "2026-05-11",
        end_date: "2026-05-24",
        acknowledge_negative_adjustments: true,
        negative_adjustment_note: "Moved the entry to its verified work date"
      )
      redistributed = batch.payroll_batch_entries.find_by!(source_time_entry_id: last_entry.id)

      expect(redistributed.regular_hours.to_f).to eq(8.0)
      expect(redistributed.overtime_hours.to_f).to eq(-8.0)
      expect(redistributed.total_hours.to_f).to eq(0.0)
    end
  end

  it "blocks missing payroll dimensions and overlapping finalized periods" do
    travel_to(guam.local(2026, 5, 16, 9)) do
      entry = create_entry(date: Date.new(2026, 5, 5))
      entry.update_columns(time_category_id: nil, effective_rate_cents_snapshot: nil)

      expect do
        finalize(start_date: "2026-05-01", end_date: "2026-05-15")
      end.to raise_error(Payroll::BatchFinalizer::FinalizationError, /missing work categories and pay rates/)

      entry.update!(time_category: category)
      finalize(start_date: "2026-05-01", end_date: "2026-05-15")
      expect do
        finalize(start_date: "2026-05-10", end_date: "2026-05-20")
      end.to raise_error(Payroll::BatchFinalizer::ExistingBatchError, /already covers/)
    end
  end

  it "enforces append-only finalized records in PostgreSQL" do
    travel_to(guam.local(2026, 5, 16, 9)) do
      create_entry(date: Date.new(2026, 5, 5))
      batch = finalize(start_date: "2026-05-01", end_date: "2026-05-15")

      expect do
        PayrollBatch.transaction(requires_new: true) do
          ActiveRecord::Base.connection.execute("UPDATE payroll_batches SET checksum = 'changed' WHERE id = #{batch.id}")
        end
      end.to raise_error(ActiveRecord::StatementInvalid, /append-only/)
      expect do
        PayrollBatch.transaction(requires_new: true) do
          ActiveRecord::Base.connection.execute("DELETE FROM payroll_batch_entries WHERE payroll_batch_id = #{batch.id}")
        end
      end.to raise_error(ActiveRecord::StatementInvalid, /append-only/)
      expect do
        PayrollBatch.transaction(requires_new: true) do
          ActiveRecord::Base.connection.execute("DELETE FROM payroll_batches WHERE id = #{batch.id}")
        end
      end.to raise_error(ActiveRecord::StatementInvalid, /append-only/)
    end
  end

  it "rolls the batch back if its required audit event cannot be written" do
    travel_to(guam.local(2026, 5, 16, 9)) do
      create_entry(date: Date.new(2026, 5, 5))
      allow(AuditLog).to receive(:record!).and_raise("audit unavailable")

      expect do
        finalize(start_date: "2026-05-01", end_date: "2026-05-15")
      end.to raise_error("audit unavailable")
      expect(PayrollBatch.count).to eq(0)
      expect(PayrollBatchEntry.count).to eq(0)
    end
  end

  it "returns a retryable payroll error when the source ledger lock times out" do
    finalizer = described_class.new(
      start_date: "2026-05-01",
      end_date: "2026-05-15",
      actor: admin
    )
    allow(finalizer).to receive(:lock_source_ledger!).and_raise(ActiveRecord::LockWaitTimeout)

    expect { finalizer.call }
      .to raise_error(Payroll::BatchFinalizer::FinalizationError, /Time tracking is busy/)
  end

  it "maps a real PostgreSQL source-ledger lock timeout to the retryable payroll error" do
    database_config = ActiveRecord::Base.connection_db_config.configuration_hash
    locker = PG.connect(
      host: database_config[:host],
      port: database_config[:port],
      user: database_config[:username],
      password: database_config[:password],
      dbname: database_config.fetch(:database)
    )
    locker.exec("BEGIN")
    locker.exec("LOCK TABLE time_entries IN ROW EXCLUSIVE MODE")
    stub_const("#{described_class}::LOCK_TIMEOUT", "50ms")

    expect do
      finalize(start_date: "2026-05-01", end_date: "2026-05-15")
    end.to raise_error(Payroll::BatchFinalizer::FinalizationError, /Time tracking is busy/)
  ensure
    locker&.exec("ROLLBACK")
    locker&.close
  end

  it "publishes the source-ledger writer-blocking duration after commit" do
    events = []
    subscriber = ActiveSupport::Notifications.subscribe("payroll.source_ledger_blocking") do |event|
      events << event
    end

    finalize(start_date: "2026-05-01", end_date: "2026-05-15")

    expect(events.one?).to be(true)
    expect(events.first.payload).to include(
      outcome: "succeeded",
      start_date: "2026-05-01",
      end_date: "2026-05-15"
    )
    expect(events.first.payload.fetch(:duration_ms)).to be >= 0
  ensure
    ActiveSupport::Notifications.unsubscribe(subscriber) if subscriber
  end

  it "keeps a committed batch successful when a telemetry subscriber raises" do
    subscriber_called = false
    subscriber = ActiveSupport::Notifications.subscribe("payroll.source_ledger_blocking") do
      subscriber_called = true
      raise "telemetry unavailable"
    end
    batch = nil

    expect do
      batch = finalize(start_date: "2026-05-01", end_date: "2026-05-15")
    end.not_to raise_error

    expect(subscriber_called).to be(true)
    expect(batch).to be_persisted
    expect(PayrollBatch.where(id: batch.id)).to exist
  ensure
    ActiveSupport::Notifications.unsubscribe(subscriber) if subscriber
  end

  it "preserves the batch snapshot when the finalizing user is later removed" do
    travel_to(guam.local(2026, 5, 16, 9)) do
      create_entry(date: Date.new(2026, 5, 5))
      batch = finalize(start_date: "2026-05-01", end_date: "2026-05-15")

      admin.destroy!

      expect(batch.reload.finalized_by).to be_nil
      expect(batch.payload.dig("finalized_by", "name")).to eq("Payroll Admin")
    end
  end
end
