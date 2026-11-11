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

  describe "a lock-now publication that arrives after its instant" do
    let(:employee) { create(:user, :employee) }
    let(:category) { create(:time_category, name: "Operations") }
    let(:entry) do
      work_date = dates.fetch(:start_date) + 2
      create(:time_entry, user: employee, time_category: category, work_date: work_date, hours: 8,
        status: "completed", approval_status: "approved", created_at: 2.days.ago)
    end

    def record_manual_paycheck!
      PayrollManualAllocation.create!(
        time_entry: entry, user: employee, recorded_by: create(:user, :admin),
        source_user_uuid: employee.payroll_integration_uuid, source_time_entry_version: entry.lock_version,
        work_date: entry.work_date, pay_date: Date.current, time_category_id: category.id,
        regular_hours: 8, overtime_hours: 0, external_pay_period_id: "68", external_payroll_item_id: "1438",
        reason: "Paid by manual check while the lock was on its way"
      )
    end

    it "is refused when a manual paycheck for its hours was recorded after the instant" do
      entry
      locked_at = (PayrollClockHelpers.database_clock - 2.minutes).change(usec: 0)
      record_manual_paycheck!

      expect { publish(override_publication(base, cutoff_at: locked_at, action: "lock_now")) }
        .to raise_error(described_class::ConflictError, /manual paycheck for these hours was recorded after .* Press Lock now again/)
      expect(period).to have_attributes(schedule_version: 1, cutoff_source: "policy")
      expect(PayrollCalendarPeriodRevision.where(schedule_version: 2)).to be_empty
    end

    it "is accepted when the paycheck was recorded before the instant" do
      record_manual_paycheck!
      locked_at = (PayrollClockHelpers.database_clock + 1.second).change(usec: 0)
      PayrollClockHelpers.wait_for_database_cutoff(locked_at)

      expect(publish(override_publication(base, cutoff_at: locked_at, action: "lock_now")).period)
        .to have_attributes(cutoff_at: locked_at, schedule_version: 2)
    end

    it "is refused when late hours were routed to this period after the instant" do
      locked_at = (PayrollClockHelpers.database_clock - 2.minutes).change(usec: 0)
      fence = Payroll::LockNowClaimFence.new(start_date: dates.fetch(:start_date), end_date: dates.fetch(:end_date),
        cutoff_at: locked_at, period: period)
      routed = instance_double(ActiveRecord::Relation, exists?: true)
      cases = PayrollSettlementCase.none
      allow(PayrollSettlementCase).to receive(:where).and_return(cases)
      allow(cases).to receive(:where).with(target_payroll_calendar_period_id: period.id).and_return(routed)
      expect { fence.call! }.to raise_error(Payroll::LockNowClaimFence::ConflictError, /settlement change/)
    end
  end

  it "limits the fence's lock timeout to its own lock wait" do
    locked_at = (PayrollClockHelpers.database_clock - 2.minutes).change(usec: 0)
    connection = ActiveRecord::Base.connection
    ActiveRecord::Base.transaction do
      connection.execute("SET LOCAL lock_timeout = '30s'")
      Payroll::LockNowClaimFence.call!(start_date: dates.fetch(:start_date), end_date: dates.fetch(:end_date),
        cutoff_at: locked_at, period: period)
      # Later statements in the publication keep the transaction's setting.
      expect(connection.select_value("SHOW lock_timeout")).to eq("30s")
    end
  end

  it "accepts a later version when Cornerstone skipped one AIRE refused, but never an older one" do
    publish(override_publication(base, cutoff_at: policy_cutoff + 1.day, version: 3))
    expect(period).to have_attributes(schedule_version: 3, cutoff_at: policy_cutoff + 1.day)

    expect { publish(override_publication(base, cutoff_at: policy_cutoff + 2.days, version: 2)) }
      .to raise_error(described_class::ConflictError, "schedule_version must be 4 or later")
    expect { publish(override_publication(base, cutoff_at: policy_cutoff + 2.days, version: 3)) }
      .to raise_error(described_class::ConflictError, "schedule_version must be 4 or later")
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
