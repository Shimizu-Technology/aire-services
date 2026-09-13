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

  it "publishes an auditable first version and replays it idempotently" do
    first = described_class.new(attributes, now: now).call
    replay = described_class.new(attributes, now: Time.iso8601(attributes.fetch(:cutoff_at)) + 1.hour).call

    expect(first.created).to be(true)
    expect(replay.idempotent).to be(true)
    expect(replay.period).to eq(first.period)
    expect(first.period.payroll_calendar_period_revisions.count).to eq(1)
    expect(AuditLog.find_by!(action: "payroll_calendar_period.published", auditable: first.period).source).to eq("integration")
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
