# frozen_string_literal: true

require "rails_helper"
require_relative "../../support/payroll_cutoff_override_helpers"

RSpec.describe Payroll::CalendarPeriodPublisher, "admin lock times" do
  include ActiveJob::TestHelper
  include PayrollCutoffOverrideHelpers

  let(:dates) { ended_period_dates }
  let(:base) { policy_publication(dates) }
  let(:policy_cutoff) { Time.iso8601(base.fetch(:cutoff_at)) }
  let(:earliest) { PayrollCalendarPeriod.earliest_override_at(dates.fetch(:end_date)) }
  let(:latest) { PayrollCalendarPeriod.latest_override_at(dates.fetch(:pay_date)) }

  before do
    configure_lock_rollout!(dates)
    described_class.new(base).call
  end

  def publish(attributes)
    described_class.new(attributes).call
  end

  def period
    PayrollCalendarPeriod.find_by!(external_pay_period_id: base.fetch(:external_pay_period_id))
  end

  it "accepts an override only when the publication says so, keeping the policy evidence" do
    moved = policy_cutoff + 1.day
    publish(override_publication(base, cutoff_at: moved))

    expect(period).to have_attributes(cutoff_at: moved, cutoff_source: "override", policy_cutoff_at: policy_cutoff,
      cutoff_days: 7, cutoff_rule: "before_pay_date", schedule_version: 2)
    expect(period.cutoff_override).to include("action" => "change", "reason" => "Payday moved for the holiday",
      "set_by" => { "name" => "Chels", "system" => "cornerstone_payroll", "role" => "org_admin" })
    expect(period.as_contract_json).to include(cutoff_source: "override", policy_cutoff_at: policy_cutoff.iso8601,
      cutoff_at: moved.iso8601)
    expect(PayrollCalendarPeriod.next_scheduled_cutoff_at).to eq(moved.iso8601)
    audit = AuditLog.find_by!(action: "payroll_calendar_period.cutoff_overridden")
    expect(audit.metadata).to include("previous_cutoff_at" => policy_cutoff.utc.iso8601, "cutoff_at" => moved.utc.iso8601)
  end

  it "keeps the strict policy check when the publication is a policy one" do
    forged = base.merge(schedule_version: 2, publication_id: SecureRandom.uuid, cutoff_at: (policy_cutoff + 1.day).iso8601)
    expect { publish(forged) }.to raise_error(ActiveRecord::RecordInvalid, /does not match the published cutoff policy/)
    expect { publish(forged.merge(cutoff_source: "policy")) }.to raise_error(ActiveRecord::RecordInvalid, /does not match the published cutoff policy/)
    expect { publish(forged.merge(cutoff_override: { reason: "sneaky" })) }.to raise_error(ArgumentError, /require cutoff_source override/)
    expect(period.reload).to have_attributes(cutoff_at: policy_cutoff, schedule_version: 1, cutoff_source: "policy")
  end

  it "rejects forged or incomplete overrides" do
    moved = policy_cutoff + 1.day
    incomplete = override_publication(base, cutoff_at: moved)
    {
      incomplete.merge(cutoff_override: incomplete[:cutoff_override].merge(reason: " ")) => /reason is required/,
      incomplete.merge(cutoff_override: incomplete[:cutoff_override].merge(action: "reopen")) => /lock_now or change/,
      incomplete.merge(cutoff_override: incomplete[:cutoff_override].except(:set_by)) => /set_by/,
      incomplete.except(:policy_cutoff_at) => /policy_cutoff_at is required/,
      incomplete.merge(cutoff_source: "admin") => /cutoff_source must be policy or override/
    }.each do |attributes, message|
      expect { publish(attributes) }.to raise_error(ArgumentError, message)
    end

    wrong_policy = override_publication(base, cutoff_at: moved, policy_cutoff_at: (policy_cutoff + 2.days).iso8601)
    expect { publish(wrong_policy) }.to raise_error(ActiveRecord::RecordInvalid, /Policy cutoff at does not match the published cutoff policy/)
    expect(period.reload.schedule_version).to eq(1)
  end

  it "enforces the lock-time bounds" do
    expect { publish(override_publication(base, cutoff_at: earliest - 1.minute)) }.to raise_error(ArgumentError, /after the period's last day/)
    expect { publish(override_publication(base, cutoff_at: latest + 1.minute)) }.to raise_error(ArgumentError, /two days before the pay date/)
    publish(override_publication(base, cutoff_at: latest))
    expect(period.cutoff_at).to eq(latest)
  end

  it "rejects an override on a manual-lock calendar" do
    manual = policy_publication(external_id: "6c6f636b-0000-4000-8000-000000000002",
      start_date: (dates.fetch(:start_date) << 1).iso8601, end_date: ((dates.fetch(:start_date) << 1) + 14).iso8601)
    expect { publish(override_publication(manual, cutoff_at: policy_cutoff, version: 1)) }.to raise_error(ArgumentError)
  end

  it "accepts a lock-now instant that has just passed and queues finalization at once" do
    locked_at = Time.current.change(usec: 0) - 2.minutes
    expect { publish(override_publication(base, cutoff_at: locked_at, action: "lock_now")) }
      .to have_enqueued_job(PayrollCutoffFinalizationJob)
    expect(period).to have_attributes(cutoff_at: locked_at, cutoff_state: "due")
  end

  it "rejects a lock-now publication that arrives after the grace window or a past change" do
    stale = Time.current - PayrollCalendarPeriod::LOCK_NOW_GRACE - 1.minute
    expect { publish(override_publication(base, cutoff_at: stale, action: "lock_now")) }.to raise_error(ArgumentError, /must be in the future/)
    expect { publish(override_publication(base, cutoff_at: Time.current - 1.minute)) }.to raise_error(ArgumentError, /must be in the future/)
  end

  it "resets to the policy cutoff and records it" do
    publish(override_publication(base, cutoff_at: policy_cutoff + 1.day))
    publish(base.merge(schedule_version: 3, publication_id: SecureRandom.uuid, cutoff_source: "policy"))

    expect(period).to have_attributes(cutoff_at: policy_cutoff, cutoff_source: "policy", policy_cutoff_at: nil, cutoff_override: nil)
    expect(AuditLog.where(action: "payroll_calendar_period.cutoff_reset").count).to eq(1)
  end

  it "accepts publications from Cornerstone builds that predate cutoff_source" do
    legacy = base.merge(schedule_version: 2, publication_id: SecureRandom.uuid, overtime_policy: base[:overtime_policy])
    expect(publish(legacy).period).to have_attributes(schedule_version: 2, cutoff_source: "policy")
    expect(AuditLog.where(action: [ "payroll_calendar_period.cutoff_overridden", "payroll_calendar_period.cutoff_reset" ])).to be_empty
  end

  it "is protected by the database even when validations are skipped" do
    record = period
    attempt = ->(attributes) { PayrollCalendarPeriod.transaction(requires_new: true) { record.update_columns(attributes) } }
    expect { attempt.call(cutoff_source: "override") }.to raise_error(ActiveRecord::StatementInvalid, /cutoff_override/)
    expect do
      attempt.call(cutoff_source: "override", policy_cutoff_at: policy_cutoff, cutoff_at: earliest - 1.minute,
        cutoff_override: { "reason" => "x", "action" => "change" })
    end.to raise_error(ActiveRecord::StatementInvalid, /check_payroll_calendar_period_cutoff_override/)
    expect do
      attempt.call(cutoff_source: "override", policy_cutoff_at: policy_cutoff + 1.day, cutoff_at: policy_cutoff,
        cutoff_override: { "reason" => "x", "action" => "change" })
    end.to raise_error(ActiveRecord::StatementInvalid, /check_payroll_calendar_period_cutoff_date/)
  end
end
