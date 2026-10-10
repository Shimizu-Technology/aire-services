# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::CalendarPeriodPublisher do
  include ActiveSupport::Testing::TimeHelpers

  let(:guam) { ActiveSupport::TimeZone["Pacific/Guam"] }
  let(:now) { guam.local(2026, 10, 1, 9) }
  let(:publication_id) { SecureRandom.uuid }
  let(:attributes) do
    {
      schema_version: "1.0",
      external_pay_period_id: "cornerstone-2026-10-a",
      start_date: "2026-10-01",
      end_date: "2026-10-15",
      pay_date: "2026-10-25",
      cutoff_at: "2026-10-18T17:00:00+10:00",
      time_zone: "Pacific/Guam",
      cutoff_days_before: 7,
      schedule_version: 1,
      publication_id: publication_id
    }
  end

  around do |example|
    travel_to(now) { example.run }
  end

  it "refuses to publish over an existing unlinked frozen batch without adopting it" do
    batch = Payroll::BatchFinalizer.new(start_date: attributes[:start_date], end_date: attributes[:end_date], actor: nil).call
    original = batch.attributes.deep_dup
    expect { described_class.new(attributes, now: now).call }
      .to raise_error(described_class::ConflictError, /already covers/)
    expect(PayrollCalendarPeriod.count).to eq(0)
    expect(PayrollCalendarPeriodRevision.count).to eq(0)
    expect(PayrollOutboxEvent.count).to eq(0)
    expect(batch.reload.attributes).to eq(original)
  end

  it "refuses a revision into a frozen manual batch and preserves the prior schedule" do
    period = described_class.new(attributes, now: now).call.period
    batch = Payroll::BatchFinalizer.new(start_date: "2026-10-16", end_date: "2026-10-31", actor: nil).call
    original = [ period.attributes.deep_dup, batch.attributes.deep_dup ]
    revision = attributes.merge(schedule_version: 2, publication_id: SecureRandom.uuid,
      start_date: "2026-10-16", end_date: "2026-10-31", pay_date: "2026-11-10", cutoff_at: "2026-11-03T17:00:00+10:00")
    expect { described_class.new(revision, now: now).call }
      .to raise_error(described_class::ConflictError, /already covers/)
    expect([ period.reload.attributes, batch.reload.attributes ]).to eq(original)
    expect(period.payroll_calendar_period_revisions.count).to eq(1)
    expect(PayrollOutboxEvent.count).to eq(0)
  end

  it "publishes an auditable first version and replays it idempotently" do
    first = described_class.new(attributes, now: now).call
    replay = described_class.new(attributes, now: Time.iso8601(attributes.fetch(:cutoff_at)) + 1.hour).call

    expect(first.created).to be(true)
    expect(replay.idempotent).to be(true)
    expect(replay.period).to eq(first.period)
    expect(first.period.payroll_calendar_period_revisions.count).to eq(1)
    expect(AuditLog.find_by!(action: "payroll_calendar_period.published", auditable: first.period).source).to eq("integration")
  end

  it "upgrades legacy policy only through an explicit publication and preserves revision evidence" do
    period = described_class.new(attributes, now: now).call.period
    legacy = { "daily_threshold_hours" => 8.0, "weekly_threshold_hours" => 40.0 }
    period.update_columns(overtime_policy: legacy)
    revised = attributes.merge(schedule_version: 2, publication_id: SecureRandom.uuid,
                               overtime_policy: Payroll::WeeklyOvertimeAllocator.configured_policy)
    result = described_class.new(revised, now: now).call
    revision = period.payroll_calendar_period_revisions.order(:schedule_version).last
    expect(result.period.reload.overtime_policy).to eq(Payroll::WeeklyOvertimeAllocator.configured_policy.stringify_keys)
    expect(revision.payload.fetch("previous_overtime_policy")).to eq(legacy)
    expect(revision.payload.fetch("overtime_policy")).to eq(result.period.overtime_policy)
    audit = AuditLog.find_by!(action: "payroll_calendar_period.revised", auditable: period)
    expect(audit.metadata).to include("previous_overtime_policy" => legacy,
                                      "overtime_policy" => result.period.overtime_policy)
    expect(described_class.new(revised, now: now).call.idempotent).to be(true)
    expect(period.payroll_calendar_period_revisions.count).to eq(2)
    expect do
      described_class.new(revised.merge(overtime_policy: legacy), now: now).call
    end.to raise_error(ArgumentError, /weekly-only/)
  end

  it "does not upgrade a legacy policy implicitly or after cutoff" do
    period = described_class.new(attributes, now: now).call.period
    legacy = { "daily_threshold_hours" => 8.0, "weekly_threshold_hours" => 40.0 }
    period.update_columns(overtime_policy: legacy)
    revised = attributes.merge(schedule_version: 2, publication_id: SecureRandom.uuid)
    described_class.new(revised, now: now).call
    expect(period.reload.overtime_policy).to eq(legacy)
    explicit = revised.merge(schedule_version: 3, publication_id: SecureRandom.uuid,
                             overtime_policy: Payroll::WeeklyOvertimeAllocator.configured_policy,
                             cutoff_at: "2026-10-18T18:00:00+10:00")
    expect do
      described_class.new(explicit, now: Time.iso8601(attributes[:cutoff_at])).call
    end.to raise_error(described_class::ConflictError, /cannot be revised after its cutoff/)
    expect(period.reload.overtime_policy).to eq(legacy)
  end

  it "preserves finalized legacy policy and refuses new computations under it" do
    period = described_class.new(attributes, now: now).call.period
    legacy = { "daily_threshold_hours" => 8.0, "weekly_threshold_hours" => 40.0 }
    batch = create(:payroll_batch)
    period.update_columns(overtime_policy: legacy, status: "finalized", finalized_at: now, payroll_batch_id: batch.id)
    revised = attributes.merge(schedule_version: 2, publication_id: SecureRandom.uuid,
                               overtime_policy: Payroll::WeeklyOvertimeAllocator.configured_policy)
    expect { described_class.new(revised, now: now).call }
      .to raise_error(described_class::ConflictError, /cannot be revised after its cutoff/)
    expect(period.reload.overtime_policy).to eq(legacy)
    expect(period.payroll_calendar_period_revisions.count).to eq(1)
    expect do
      Payroll::BatchBuilder.new(start_date: period.start_date, end_date: period.end_date, calendar_period: period)
    end.to raise_error(Payroll::BatchBuilder::PolicyUnavailableError, /operator-reviewed correction/)
  end

  it "retains revisions and requires the next schedule version" do
    period = described_class.new(attributes, now: now).call.period
    revised = attributes.merge(
      schedule_version: 2,
      publication_id: SecureRandom.uuid,
      cutoff_at: "2026-10-18T16:30:00+10:00"
    )

    result = described_class.new(revised, now: now).call

    expect(result.period.reload.schedule_version).to eq(2)
    expect(result.period.cutoff_at).to eq(Time.iso8601(revised[:cutoff_at]))
    expect(period.payroll_calendar_period_revisions.order(:schedule_version).pluck(:schedule_version)).to eq([ 1, 2 ])
  end

  it "accepts a version 2 target-run lock based on the previous regular payday" do
    version_two = attributes.except(:cutoff_days_before).merge(
      schema_version: "2.0",
      cutoff_rule: "after_previous_regular_payday",
      cutoff_days: 7,
      previous_regular_pay_date: "2026-10-10",
      cutoff_at: "2026-10-17T17:00:00+10:00"
    )

    result = described_class.new(version_two, now: now).call

    expect(result.period).to have_attributes(
      schema_version: "2.0",
      cutoff_rule: "after_previous_regular_payday",
      cutoff_days: 7,
      previous_regular_pay_date: Date.new(2026, 10, 10)
    )
    expect(result.period.as_contract_json).to include(
      cutoff_at: "2026-10-17T17:00:00+10:00",
      previous_regular_pay_date: "2026-10-10"
    )
    expect(result.period.as_contract_json).not_to have_key(:cutoff_days_before)
    audit_metadata = AuditLog.find_by!(action: "payroll_calendar_period.published", auditable: result.period).metadata
    expect(audit_metadata).to include(
      "schema_version" => "2.0",
      "cutoff_rule" => "after_previous_regular_payday",
      "cutoff_days" => 7,
      "previous_regular_pay_date" => "2026-10-10"
    )
    expect(audit_metadata).not_to have_key("cutoff_days_before")
  end

  it "accepts a version 2 configurable pay-date cutoff without a previous payday" do
    version_two = attributes.except(:cutoff_days_before).merge(
      schema_version: "2.0",
      cutoff_rule: "before_pay_date",
      cutoff_days: 5,
      cutoff_at: "2026-10-20T17:00:00+10:00"
    )

    result = described_class.new(version_two, now: now).call

    expect(result.period).to have_attributes(
      schema_version: "2.0",
      cutoff_rule: "before_pay_date",
      cutoff_days: 5,
      previous_regular_pay_date: nil
    )
    expect(result.period.as_contract_json).not_to have_key(:cutoff_days_before)
    expect(result.period.as_contract_json).not_to have_key(:previous_regular_pay_date)
  end

  it "rejects a version 2 cutoff that disagrees with its previous regular payday" do
    version_two = attributes.except(:cutoff_days_before).merge(
      schema_version: "2.0",
      cutoff_rule: "after_previous_regular_payday",
      cutoff_days: 7,
      previous_regular_pay_date: "2026-10-10"
    )

    expect do
      described_class.new(version_two, now: now).call
    end.to raise_error(ActiveRecord::RecordInvalid, /published cutoff policy/)
  end

  it "rejects a revision that would move an assigned settlement case before its origin" do
    target_attributes = attributes.merge(
      external_pay_period_id: "cornerstone-2026-11-a",
      start_date: "2026-11-01",
      end_date: "2026-11-15",
      pay_date: "2026-11-25",
      cutoff_at: "2026-11-18T17:00:00+10:00"
    )
    period = described_class.new(target_attributes, now: now).call.period
    origin_batch = create(
      :payroll_batch,
      start_date: Date.new(2026, 10, 16),
      end_date: Date.new(2026, 10, 31),
      cutoff_at: guam.local(2026, 11, 3, 17),
      finalized_at: guam.local(2026, 11, 3, 17)
    )
    create(
      :payroll_settlement_case,
      origin_payroll_batch: origin_batch,
      destination_kind: "regular",
      status: "scheduled",
      target_payroll_calendar_period: period,
      target_external_pay_period_id: period.external_pay_period_id
    )
    invalid_revision = target_attributes.merge(
      schedule_version: 2,
      publication_id: SecureRandom.uuid,
      start_date: "2026-10-16",
      end_date: "2026-10-31",
      pay_date: "2026-11-10",
      cutoff_at: "2026-11-03T17:00:00+10:00"
    )

    expect { described_class.new(invalid_revision, now: now).call }
      .to raise_error(described_class::ConflictError, /assigned settlement case/)
    expect(period.reload.start_date).to eq(Date.new(2026, 11, 1))
  end

  it "rejects a reused publication ID with different content" do
    described_class.new(attributes, now: now).call

    expect do
      described_class.new(attributes.merge(pay_date: "2026-10-26"), now: now).call
    end.to raise_error(described_class::ConflictError, /publication_id/)
  end

  it "does not collapse distinct fractional cutoff timestamps into an idempotent replay" do
    first = attributes.merge(cutoff_at: "2026-10-18T17:00:00.100000+10:00")
    different_fraction = attributes.merge(cutoff_at: "2026-10-18T17:00:00.900000+10:00")
    described_class.new(first, now: now).call

    expect do
      described_class.new(different_fraction, now: now).call
    end.to raise_error(described_class::ConflictError, /publication_id/)
  end

  it "rejects stale versions, overlapping periods, and post-cutoff changes" do
    period = described_class.new(attributes, now: now).call.period

    expect do
      described_class.new(attributes.merge(publication_id: SecureRandom.uuid), now: now).call
    end.to raise_error(described_class::ConflictError, /schedule_version must be 2/)

    overlap = attributes.merge(
      external_pay_period_id: "cornerstone-overlap",
      publication_id: SecureRandom.uuid
    )
    expect { described_class.new(overlap, now: now).call }
      .to raise_error(described_class::ConflictError, /cannot overlap/)

    expect do
      described_class.new(
        attributes.merge(schedule_version: 2, publication_id: SecureRandom.uuid),
        now: period.cutoff_at
      ).call
    end.to raise_error(ArgumentError, /future when published/)
  end

  it "enforces semimonthly dates, Guam timezone, T-7, and explicit timestamp offsets" do
    invalid_examples = [
      [ attributes.merge(start_date: "2026-10-02", publication_id: SecureRandom.uuid),
       ActiveRecord::RecordInvalid, /1st–15th or 16th–month end/ ],
      [ attributes.merge(time_zone: "UTC", publication_id: SecureRandom.uuid),
       ActiveRecord::RecordInvalid, /Time zone is not included/ ],
      [ attributes.merge(cutoff_at: "2026-10-17T17:00:00+10:00", publication_id: SecureRandom.uuid),
       ActiveRecord::RecordInvalid, /seven calendar days/ ],
      [ attributes.merge(cutoff_at: "2026-10-18T17:00:00", publication_id: SecureRandom.uuid),
       ArgumentError, /explicit UTC offset/ ]
    ]

    invalid_examples.each do |invalid, error_class, message|
      expect { described_class.new(invalid, now: now).call }.to raise_error(error_class, message)
    end
  end

  it "enforces append-only revision history in PostgreSQL" do
    period = described_class.new(attributes, now: now).call.period
    revision = period.payroll_calendar_period_revisions.first

    expect do
      PayrollCalendarPeriodRevision.transaction(requires_new: true) do
        ActiveRecord::Base.connection.execute(
          "UPDATE payroll_calendar_period_revisions SET schedule_version = 9 WHERE id = #{revision.id}"
        )
      end
    end.to raise_error(ActiveRecord::StatementInvalid, /append-only/)
  end

  it "enforces Guam T-7 and post-cutoff schedule immutability in PostgreSQL" do
    period = described_class.new(attributes, now: now).call.period

    expect do
      PayrollCalendarPeriod.transaction(requires_new: true) do
        period.update_columns(time_zone: "UTC")
      end
    end.to raise_error(ActiveRecord::StatementInvalid, /check_payroll_calendar_period_time_zone/)
    expect do
      PayrollCalendarPeriod.transaction(requires_new: true) do
        period.update_columns(cutoff_at: period.cutoff_at + 1.day)
      end
    end.to raise_error(ActiveRecord::StatementInvalid, /check_payroll_calendar_period_cutoff_date/)

    past_period = create(
      :payroll_calendar_period,
      external_pay_period_id: "past-cutoff-period",
      start_date: Date.new(2026, 8, 16),
      end_date: Date.new(2026, 8, 31),
      pay_date: Date.new(2026, 9, 13),
      cutoff_at: Time.iso8601("2026-09-06T17:00:00+10:00")
    )
    expect do
      PayrollCalendarPeriod.transaction(requires_new: true) do
        past_period.update_columns(schedule_version: 2)
      end
    end.to raise_error(ActiveRecord::StatementInvalid, /cannot change after cutoff/)
  end
end
