# frozen_string_literal: true

require "rails_helper"
require_relative "../../support/payroll_clock_helpers"

RSpec.describe "Installation payroll lock rollout", :lock_rollout do
  include ActiveSupport::Testing::TimeHelpers
  include PayrollClockHelpers

  let(:guam) { ActiveSupport::TimeZone["Pacific/Guam"] }
  let(:actor) { create(:user, :admin) }
  let(:reason) { "Accountant reviewed and locked this manual period" }

  def configure
    PayrollLockRollout.configure!(starts_on: "2026-10-16", actor: "test operator", reason: "Approved rollout decision")
  end

  def publication(second_half: false, **extra)
    {
      schema_version: "2.0", external_pay_period_id: second_half ? "oct-b" : "oct-a",
      start_date: second_half ? "2026-10-16" : "2026-10-01",
      end_date: second_half ? "2026-10-31" : "2026-10-15",
      pay_date: second_half ? "2026-11-15" : "2026-10-31",
      previous_regular_pay_date: second_half ? "2026-10-31" : "2026-10-15",
      cutoff_at: second_half ? "2026-11-07T17:00:00+10:00" : "2026-10-22T17:00:00+10:00",
      cutoff_rule: "after_previous_regular_payday", cutoff_days: 7, schedule_version: 1,
      publication_id: SecureRandom.uuid
    }.merge(extra)
  end

  def publish(**options)
    Payroll::CalendarPeriodPublisher.new(publication(**options), now: guam.local(2026, 10, 24, 12)).call.period
  end

  def entry(period, **extra)
    date = period.start_date + 2.days
    create(:time_entry, user: create(:user, :employee), time_category: create(:time_category),
      work_date: date, start_time: guam.local(date.year, date.month, date.day, 8),
      end_time: guam.local(date.year, date.month, date.day, 16), entry_method: "manual",
      approval_status: "approved", approved_at: Time.current, overtime_status: "none", **extra)
  end

  it "requires a configured installation before any new publication" do
    allow(PayrollLockRollout).to receive(:installation).and_raise(ArgumentError, "Configure the installation lock rollout first")
    expect { publish }.to raise_error(ArgumentError, /Configure/)
  end

  it "validates, audits and permanently freezes the singleton boundary" do
    config = configure
    expect(config.cutoff_enforcement_starts_on.iso8601).to eq("2026-10-16")
    expect(AuditLog.find_by!(action: "payroll_lock_rollout.configured", auditable: config).metadata)
      .to include("configured_by" => "test operator", "reason" => "Approved rollout decision")
    expect(configure).to eq(config)
    expect { PayrollLockRollout.configure!(starts_on: "2026-11-01", actor: "other", reason: reason) }
      .to raise_error(ArgumentError, /immutable/)
    expect { PayrollLockRollout.new(cutoff_enforcement_starts_on: "2026-10-17", configured_by: "operator", reason: reason).save! }
      .to raise_error(ActiveRecord::RecordInvalid)
    [ "UPDATE payroll_lock_rollouts SET cutoff_enforcement_starts_on = '2026-11-01'", "DELETE FROM payroll_lock_rollouts", "TRUNCATE payroll_lock_rollouts" ].each do |sql|
      expect { PayrollLockRollout.transaction(requires_new: true) { ActiveRecord::Base.connection.execute(sql) } }
        .to raise_error(ActiveRecord::StatementInvalid, /immutable/)
    end
  end

  it "derives manual for a legacy publication after nominal cutoff without rewriting policy" do
    configure
    period = publish
    expect(period.lock_mode).to eq("manual")
    expect(period.cutoff_at).to eq(Time.iso8601("2026-10-22T17:00:00+10:00"))
    expect(period.as_contract_json).to include(lock_mode: "manual", cutoff_enforcement_starts_on: "2026-10-16",
      cutoff_state: "manual", next_scheduled_cutoff_at: nil)
    expect(period.payroll_calendar_period_revisions.last.payload).to include("lock_mode" => "manual")
    expect(PayrollCalendarPeriod.due_at(Time.current + 1.year)).not_to include(period)
    expect(Payroll::ScheduledCutoffFinalizer.new(period_id: period.id).call[:status]).to eq("skipped")
    expect { Payroll::ScheduledCutoffFinalizer.call_due }.not_to change(PayrollBatch, :count)
    expect(period.reload.finalization_attempts).to eq(0)
    expect(period.payroll_outbox_events.count).to eq(0)
  end

  it "validates explicit mode and activation and derives scheduled for legacy callers on activation" do
    configure
    expect { publish(lock_mode: "scheduled") }.to raise_error(ArgumentError, /lock_mode/)
    expect { publish(cutoff_enforcement_starts_on: "2026-11-01") }.to raise_error(ArgumentError, /cutoff_enforcement_starts_on/)
    expect { publish(second_half: true, lock_mode: "manual") }.to raise_error(ArgumentError, /lock_mode/)
    period = publish(second_half: true, lock_mode: "scheduled", cutoff_enforcement_starts_on: "2026-10-16")
    expect(period.as_contract_json).to include(lock_mode: "scheduled", next_scheduled_cutoff_at: "2026-11-07T17:00:00+10:00")
    expect(PayrollCalendarPeriod.due_at(period.cutoff_at - 1.second)).not_to include(period)
    expect(PayrollCalendarPeriod.due_at(period.cutoff_at)).to include(period)
  end

  it "reports the installation next scheduled published cutoff on every calendar, retaining delayed due periods" do
    configure
    manual = publish
    expect(manual.as_contract_json[:next_scheduled_cutoff_at]).to be_nil
    scheduled = publish(second_half: true)
    expect(manual.as_contract_json[:next_scheduled_cutoff_at]).to eq("2026-11-07T17:00:00+10:00")
    travel_to(guam.local(2026, 11, 8, 12)) do
      expect(PayrollCalendarPeriod.next_scheduled_cutoff_at).to eq("2026-11-07T17:00:00+10:00")
      expect(Payroll::ScheduledCutoffFinalizer.new(period_id: scheduled.id).call[:status]).to eq("finalized")
      expect(manual.reload.as_contract_json[:next_scheduled_cutoff_at]).to be_nil
    end
  end

  it "protects mode and nominal policy from direct DB drift while preserving preexisting calendars" do
    legacy = create(:payroll_calendar_period, start_date: "2026-10-01", end_date: "2026-10-15", pay_date: "2026-10-31", cutoff_at: "2026-10-24T17:00:00+10:00")
    before = legacy.attributes.deep_dup
    configure
    expect(legacy.reload.attributes).to eq(before)
    expect(legacy.lock_mode).to eq("scheduled")
    expect(PayrollCalendarPeriod.due_at(Time.current + 1.year)).not_to include(legacy)
    expect(Payroll::ScheduledCutoffFinalizer.new(period_id: legacy.id).call[:status]).to eq("skipped")
    expect { legacy.transaction(requires_new: true) { legacy.update_columns(lock_mode: "manual") } }
      .to raise_error(ActiveRecord::StatementInvalid, /lock mode/)
  end

  it "skips manual claim fences and snapshots approvals at lock now, with one frozen settlement origin" do
    configure
    period = publish
    included = entry(period)
    held = entry(period, approval_status: "pending", approved_at: nil)
    expect { Payroll::PendingCutoffClaimGuard.call!(entry: included, fence_relevant_snapshots: true) }.not_to raise_error
    preview = Payroll::CockpitPeriodSnapshot.new(period: period, entries: [ included, held ]).call
    expect(preview.readiness[:eligible_hours]).to eq(8)
    before_lock = database_clock
    result = Payroll::ManualCalendarFinalizer.new(period_id: period.id, actor: actor, reason: reason).call
    expect(result[:status]).to eq("finalized"), result.inspect
    batch = period.reload.payroll_batch
    expect(batch.cutoff_at).to be >= before_lock
    expect(batch.cutoff_at).to be > period.cutoff_at
    expect(batch.payroll_batch_entries.pluck(:source_time_entry_id)).to eq([ included.id ])
    expect(batch.payroll_batch_exclusions.pluck(:source_time_entry_id, :reason)).to include([ held.id, "pending_approval" ])
    expect(batch.finalized_by).to eq(actor)
    expected_instant = batch.reload.cutoff_at.iso8601(6)
    expect(period.reload.as_contract_json[:locked_at]).to eq(expected_instant)
    expect(batch.payload["cutoff_at"]).to eq(expected_instant)
    expect(batch.export_payload.dig("export", "cutoff_at")).to eq(expected_instant)
    expect(period.payroll_outbox_events.first.payload.dig("payroll_period", "locked_at")).to eq(expected_instant)
    expect(period.payroll_outbox_events.first.payload.dig("payroll_batch", "cutoff_at")).to eq(expected_instant)
    expect(period.payroll_outbox_events.count).to eq(1)
    expect(AuditLog.find_by!(action: "payroll_calendar_period.finalized", auditable: period).metadata).to include("reason" => reason)
    expect(PayrollSettlementCase.find_by!(origin_payroll_batch: batch, source_time_entry_id: held.id).origin_payroll_batch).to eq(batch)
    original = batch.attributes.deep_dup
    Payroll::SettlementCaseCoordinator.sync_finalized_periods!
    expect(PayrollSettlementCase.where(origin_payroll_batch: batch, source_time_entry_id: included.id)).to be_empty
    expect(Payroll::ManualCalendarFinalizer.new(period_id: period.id, actor: actor, reason: reason).call[:payroll_batch_id]).to eq(batch.public_id)
    expect(batch.reload.attributes).to eq(original)
    batch.payroll_batch_processing_events.create!(event_id: "manual-payment", status: "payment_issued",
      external_system: "cornerstone_payroll", occurred_at: Time.current)
    next_period = publish(second_half: true)
    preview = Payroll::BatchBuilder.new(start_date: next_period.start_date, end_date: next_period.end_date,
      cutoff_at: database_clock, calendar_period: next_period).call
    expect(preview[:rows].map { |row| row[:source_time_entry_id] }).not_to include(included.id)
    travel_to(next_period.cutoff_at + 1.hour) do
      outcome = Payroll::ScheduledCutoffFinalizer.new(period_id: next_period.id).call
      expect(outcome[:status]).to eq("finalized"), outcome.inspect
      expect(next_period.reload.payroll_batch.payroll_batch_entries.pluck(:source_time_entry_id)).not_to include(included.id)
      expect(batch.reload.attributes).to eq(original)
    end
  end

  it "freezes weekly overtime at manual lock now and preserves revision coverage enforcement" do
    configure
    period = publish
    employee = create(:user, :employee)
    category = create(:time_category)
    # Sunday-Friday October 4-9: 50 hours in one Guam workweek.
    5.times do |index|
      date = Date.new(2026, 10, 4) + index.days
      create(:time_entry, user: employee, time_category: category, work_date: date,
        start_time: guam.local(2026, 10, date.day, 8), end_time: guam.local(2026, 10, date.day, 18),
        entry_method: "manual", approval_status: "approved", approved_at: Time.current,
        overtime_status: "approved", overtime_approved_at: Time.current, overtime_approved_by: actor)
    end
    result = Payroll::ManualCalendarFinalizer.new(period_id: period.id, actor: actor, reason: reason).call
    expect(result[:status]).to eq("finalized"), result.inspect
    rows = period.reload.payroll_batch.payroll_batch_entries
    expect(rows.sum(:regular_hours)).to eq(40)
    expect(rows.sum(:overtime_hours)).to eq(10)
    expect(period.payroll_batch.payload["overtime_policy"]).to eq(period.overtime_policy)
  end

  it "fails manual locking closed when revision coverage is unavailable" do
    configure
    period = publish
    entry(period)
    allow_any_instance_of(Payroll::TimeEntryRevisionLedger).to receive(:require_coverage!).and_raise(Payroll::TimeEntryRevisionLedger::CoverageError, "missing evidence")
    result = Payroll::ManualCalendarFinalizer.new(period_id: period.id, actor: actor, reason: reason).call
    expect(result[:status]).to eq("failed")
    expect(period.reload.payroll_batch).to be_nil
    expect(period.payroll_outbox_events.count).to eq(0)
    expect(Payroll::ScheduledCutoffFinalizer.new(period_id: period.id).call[:status]).to eq("skipped")
  end

  it "cannot bypass published calendar control via direct automated or manual batch calls" do
    configure
    period = publish
    [ {}, { automated_cutoff: true, cutoff_at: period.cutoff_at.iso8601 },
      { automated_cutoff: true, cutoff_at: period.cutoff_at.iso8601, calendar_period: period } ].each do |options|
      expect { Payroll::BatchFinalizer.new(start_date: period.start_date, end_date: period.end_date, actor: actor, **options).call }
        .to raise_error(Payroll::BatchFinalizer::PublishedCalendarError)
    end
    scheduled = publish(second_half: true)
    result = Payroll::ManualCalendarFinalizer.new(period_id: scheduled.id, actor: actor, reason: reason).call
    expect(result[:status]).to eq("skipped")
    expect { Payroll::ManualCalendarFinalizer.new(period_id: period.id, actor: nil, reason: "") }.to raise_error(ArgumentError)
  end
end
