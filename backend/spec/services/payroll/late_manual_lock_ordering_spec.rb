# frozen_string_literal: true

require 'rails_helper'

# The first two regressions reproduce review-388-143/aire_review_probes_spec.rb.
RSpec.describe "Late manual calendar lock ordering" do
  include ActiveSupport::Testing::TimeHelpers
  let(:guam) { ActiveSupport::TimeZone['Pacific/Guam'] }
  let(:actor) { create(:user, :admin) }

  before do
    PayrollLockRollout.configure!(starts_on: '2026-10-16', actor: 'Independent reviewer', reason: 'Synthetic independent ordering probe')
  end

  def publish(second_half)
    Payroll::CalendarPeriodPublisher.new({
      schema_version: '2.0', external_pay_period_id: second_half ? 'probe-oct-b' : 'probe-oct-a',
      start_date: second_half ? '2026-10-16' : '2026-10-01', end_date: second_half ? '2026-10-31' : '2026-10-15',
      pay_date: second_half ? '2026-11-15' : '2026-10-31', previous_regular_pay_date: second_half ? '2026-10-31' : '2026-10-15',
      cutoff_at: second_half ? '2026-11-07T17:00:00+10:00' : '2026-10-22T17:00:00+10:00',
      cutoff_rule: 'after_previous_regular_payday', cutoff_days: 7, schedule_version: 1, publication_id: SecureRandom.uuid,
      lock_mode: second_half ? 'scheduled' : 'manual', cutoff_enforcement_starts_on: '2026-10-16'
    }, now: guam.local(2026, 10, 24, 12)).call.period
  end

  def lock_on_nov8(period)
    instant = guam.local(2026, 11, 8, 12)
    connection = ActiveRecord::Base.connection
    allow(connection).to receive(:select_value).and_call_original
    allow(connection).to receive(:select_value).with('SELECT clock_timestamp()').and_return(instant)
    travel_to(instant) { Payroll::ManualCalendarFinalizer.new(period_id: period.id, actor: actor, reason: 'Accountant is now ready to lock October first half').call }
  end

  it 'keeps the first scheduled cutoff operable when the accountant locks the manual predecessor after November 7' do
    manual = publish(false)
    scheduled = publish(true)
    expect(lock_on_nov8(manual)[:status]).to eq('finalized')
    result = travel_to(guam.local(2026, 11, 8, 12)) { Payroll::ScheduledCutoffFinalizer.new(period_id: scheduled.id).call }
    expect(result[:status]).to eq('finalized')
  end

  it 'does not reverse already frozen October 16 hours when October 1-15 is manually locked later' do
    manual = publish(false)
    scheduled = publish(true)
    employee = create(:user, :employee)
    category = create(:time_category)
    [ 15, 16 ].each do |day|
      create(:time_entry, user: employee, time_category: category, work_date: Date.new(2026, 10, day),
        start_time: guam.local(2026, 10, day, 8), end_time: guam.local(2026, 10, day, 16),
        entry_method: 'manual', approval_status: 'approved', approved_at: Time.current, overtime_status: 'none')
    end
    result = travel_to(scheduled.cutoff_at + 1.minute) { Payroll::ScheduledCutoffFinalizer.new(period_id: scheduled.id).call }
    expect(result[:status]).to eq('finalized'), result.inspect
    expect(scheduled.reload.payroll_batch.summary['total_hours']).to eq(8)
    scheduled.payroll_batch.payroll_batch_processing_events.create!(event_id: SecureRandom.uuid, status: "payment_issued",
      external_system: "cornerstone_payroll", occurred_at: guam.local(2026, 11, 8, 8))
    frozen = scheduled.payroll_batch.attributes.deep_dup
    result = lock_on_nov8(manual)
    expect(result[:status]).to eq('finalized'), result.inspect
    rows = manual.reload.payroll_batch.payroll_batch_entries.pluck(:work_date, :total_hours)
    expect(rows.map { |date, hours| [ date.iso8601, hours.to_f ] }).to eq([ [ '2026-10-15', 8.0 ] ])
    expect(scheduled.payroll_batch.reload.attributes).to eq(frozen)
  end

  def approved_entry(employee, category, day, overnight: false)
    create(:time_entry, user: employee, time_category: category, work_date: Date.new(2026, 10, day),
      start_time: guam.local(2026, 10, day, overnight ? 20 : 8),
      end_time: overnight ? guam.local(2026, 10, day + 1, 4) : guam.local(2026, 10, day, 16),
      clock_in_at: overnight ? guam.local(2026, 10, day, 20) : nil,
      clock_out_at: overnight ? guam.local(2026, 10, day + 1, 4) : nil,
      entry_method: overnight ? "clock" : "manual", approval_status: "approved", approved_at: Time.current, overtime_status: "none")
  end

  def scheduled_lock(period)
    travel_to(guam.local(2026, 11, 8, 12)) { Payroll::ScheduledCutoffFinalizer.new(period_id: period.id).call }
  end

  [ :manual_first, :scheduled_first ].each do |order|
    [ false, true ].each do |overnight|
      it "settles each date once with #{order} and #{overnight ? 'an overnight October 15-16 entry' : 'separate same-week entries'}" do
        manual = publish(false)
        scheduled = publish(true)
        employee = create(:user, :employee)
        category = create(:time_category)
        approved_entry(employee, category, 15, overnight: overnight)
        approved_entry(employee, category, 16) unless overnight
        periods = order == :manual_first ? [ manual, scheduled ] : [ scheduled, manual ]
        periods.each do |period|
          result = period == manual ? lock_on_nov8(period) : scheduled_lock(period)
          expect(result[:status]).to eq("finalized"), result.inspect
          batch = period.reload.payroll_batch
          expected_date = period == manual ? "2026-10-15" : "2026-10-16"
          expected_hours = overnight ? 4 : 8
          expect(batch.payroll_batch_entries.pluck(:work_date, :total_hours).map { |date, hours| [ date.iso8601, hours.to_f ] })
            .to eq([ [ expected_date, expected_hours.to_f ] ])
        end
        expect(scheduled.reload.payroll_batch.cutoff_at).to eq(scheduled.cutoff_at)
        expect(PayrollBatchEntry.sum(:total_hours)).to eq(overnight ? 8 : 16)
      end
    end

    it "finalizes empty periods with #{order}" do
      manual = publish(false)
      scheduled = publish(true)
      periods = order == :manual_first ? [ manual, scheduled ] : [ scheduled, manual ]
      periods.each do |period|
        result = period == manual ? lock_on_nov8(period) : scheduled_lock(period)
        expect(result[:status]).to eq("finalized"), result.inspect
        expect(period.reload.payroll_batch.payroll_batch_entries).to be_empty
      end
    end
  end

  it "leaves changed and deleted later-entry corrections outside the earlier manual lock" do
    manual = publish(false)
    scheduled = publish(true)
    employee = create(:user, :employee)
    category = create(:time_category)
    approved_entry(employee, category, 15)
    changed = approved_entry(employee, category, 16)
    deleted = approved_entry(employee, category, 17)
    expect(scheduled_lock(scheduled)[:status]).to eq("finalized")
    frozen = scheduled.reload.payroll_batch.attributes.deep_dup
    changed.update!(end_time: guam.local(2026, 10, 16, 18))
    deleted.destroy!
    expect(lock_on_nov8(manual)[:status]).to eq("finalized")
    rows = manual.reload.payroll_batch.payroll_batch_entries
    expect(rows.where(source_time_entry_id: [ changed.id, deleted.id ])).not_to exist
    expect(scheduled.payroll_batch.reload.attributes).to eq(frozen)
    expect(manual.payroll_batch.payload["requires_negative_adjustment_review"]).not_to eq(true)
  end

  it "retains post-Lock edits as settlement work without changing either frozen batch" do
    manual = publish(false)
    scheduled = publish(true)
    employee = create(:user, :employee)
    category = create(:time_category)
    earlier = approved_entry(employee, category, 15)
    approved_entry(employee, category, 16)
    expect(scheduled_lock(scheduled)[:status]).to eq("finalized")
    expect(lock_on_nov8(manual)[:status]).to eq("finalized")
    originals = [ manual.reload.payroll_batch, scheduled.reload.payroll_batch ].map { |batch| batch.attributes.deep_dup }
    # Source revision timestamps follow the real database clock, not Rails travel_to.
    cutoff = manual.payroll_batch.cutoff_at
    travel_to(cutoff + 1.day) { earlier.update!(end_time: guam.local(2026, 10, 15, 18)) }
    Payroll::SettlementCaseCoordinator.sync_finalized_periods!
    expect([ manual.payroll_batch.reload, scheduled.payroll_batch.reload ].map(&:attributes)).to eq(originals)
    expect(PayrollSettlementCase.where(origin_payroll_batch: manual.payroll_batch, source_time_entry_id: earlier.id,
      origin_reason: "changed_after_cutoff")).to exist
  end

  it "keeps the original scheduled revision snapshot without reversing a newer predecessor claim" do
    manual = publish(false)
    scheduled = publish(true)
    employee = create(:user, :employee)
    category = create(:time_category)
    earlier = approved_entry(employee, category, 15)
    later = approved_entry(employee, category, 16)
    # Append a synthetic future revision; PostgreSQL's actual capture triggers
    # remain unchanged. Only the November 8 manual snapshot can see this edit.
    [ [ earlier, 10, 18 ], [ later, 12, 20 ] ].each do |entry, hours, end_hour|
      revision = PayrollTimeEntryRevision.where(source_time_entry_id: entry.id).order(:id).last
      snapshot = revision.snapshot.deep_dup
      snapshot.fetch("time_entry").merge!("hours" => hours.to_s, "lock_version" => entry.lock_version + 1,
        "end_time" => guam.local(2000, 1, 1, end_hour).utc.iso8601(6),
        "updated_at" => (scheduled.cutoff_at + 1.hour).iso8601(6))
      PayrollTimeEntryRevision.create!(revision.attributes.except("id").merge(
        recorded_at: scheduled.cutoff_at + 1.hour, source_version: entry.lock_version + 1, snapshot: snapshot))
    end
    expect(lock_on_nov8(manual)[:status]).to eq("finalized")
    expect(manual.reload.payroll_batch.payroll_batch_entries.sum(:total_hours)).to eq(10)
    frozen = manual.payroll_batch.attributes.deep_dup
    expect(scheduled_lock(scheduled)[:status]).to eq("finalized")
    batch = scheduled.reload.payroll_batch
    expect(batch.cutoff_at).to eq(scheduled.cutoff_at)
    expect(batch.payroll_batch_entries.pluck(:work_date, :total_hours)).to eq([ [ Date.new(2026, 10, 16), 8 ] ])
    expect(manual.payroll_batch.reload.attributes).to eq(frozen)
  end

  it "keeps the genuine later payroll-period fence even when its snapshot timestamp is earlier" do
    scheduled = publish(true)
    create(:payroll_batch, start_date: "2026-11-01", end_date: "2026-11-15",
      cutoff_at: guam.local(2026, 11, 6, 12), finalized_at: guam.local(2026, 11, 6, 12))
    result = scheduled_lock(scheduled)
    expect(result).to include(status: "failed", error: /later payroll batch/)
    expect(scheduled.reload.next_finalization_attempt_at).to be_nil
    expect(scheduled.payroll_batch).to be_nil
  end
end
