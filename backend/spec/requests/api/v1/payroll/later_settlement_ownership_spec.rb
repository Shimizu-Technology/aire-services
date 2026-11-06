# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Late manual lock respects later settlement ownership", type: :request do
  include ActiveSupport::Testing::TimeHelpers

  let(:guam) { ActiveSupport::TimeZone["Pacific/Guam"] }
  let(:actor) { create(:user, :admin) }
  let(:employee) { create(:user, :employee) }
  let(:category) { create(:time_category) }

  around do |example|
    previous = ENV["PAYROLL_SHARED_SECRET"]
    ENV["PAYROLL_SHARED_SECRET"] = "settlement-ownership-test"
    example.run
  ensure
    ENV["PAYROLL_SHARED_SECRET"] = previous
  end

  def entry(day)
    create(:time_entry, user: employee, time_category: category, work_date: Date.new(2026, 10, day),
      start_time: guam.local(2026, 10, day, 8), end_time: guam.local(2026, 10, day, 16),
      entry_method: "manual", approval_status: "approved", approved_at: Time.current, overtime_status: "none")
  end

  def prepare_periods(prefix: false, freeze_scheduled: true, overnight: false)
    PayrollLockRollout.configure!(starts_on: "2026-10-16", actor: "test operator", reason: "Approved ownership rehearsal")
    @manual = create(:payroll_calendar_period, start_date: "2026-10-01", end_date: "2026-10-15", pay_date: "2026-10-31",
      cutoff_at: guam.local(2026, 10, 24, 17), lock_mode: "manual", cutoff_enforcement_starts_on: "2026-10-16")
    @prefix = prefix ? (11..14).map { |day| entry(day) } : []
    if overnight
      @later = create(:time_entry, user: employee, time_category: category, work_date: Date.new(2026, 10, 15),
        start_time: guam.local(2026, 10, 15, 20), end_time: guam.local(2026, 10, 16, 4),
        clock_in_at: guam.local(2026, 10, 15, 20), clock_out_at: guam.local(2026, 10, 16, 4),
        entry_method: "clock", approval_status: "approved", approved_at: Time.current, overtime_status: "none")
    else
      @earlier = entry(15)
      @later = entry(16)
    end
    review_overtime
    cutoff = ActiveRecord::Base.connection.select_value("SELECT clock_timestamp()").in_time_zone("Pacific/Guam")
    @scheduled = create(:payroll_calendar_period, start_date: "2026-10-16", end_date: "2026-10-31",
      pay_date: cutoff.to_date + 7, cutoff_at: cutoff, lock_mode: "scheduled", cutoff_enforcement_starts_on: "2026-10-16")
    @successor = create(:payroll_calendar_period, start_date: "2026-11-01", end_date: "2026-11-15", pay_date: "2026-11-30",
      cutoff_at: guam.local(2026, 11, 23, 17), lock_mode: "scheduled", cutoff_enforcement_starts_on: "2026-10-16")
    freeze_scheduled_period if freeze_scheduled
  end

  def freeze_scheduled_period
    expect(Payroll::ScheduledCutoffFinalizer.new(period_id: @scheduled.id).call).to include(status: "finalized")
    @scheduled.reload
    @original = @scheduled.payroll_batch.attributes.deep_dup
    receipts(@scheduled.payroll_batch)
  end

  def review_overtime
    TimeEntry.where(user: employee).find_each do |item|
      item.update!(overtime_status: "approved", overtime_approved_by: actor, overtime_approved_at: Time.current)
    end
    @earlier&.reload
    @later&.reload
  end

  def receipts(batch, statuses: %w[imported committed], metadata: {})
    batch.payroll_batch_entries.each do |line|
      statuses.each do |status|
        post "/api/v1/payroll/batches/#{batch.public_id}/processing_events", params: {
          event_id: SecureRandom.uuid, status: status, occurred_at: Time.current.iso8601(6), external_system: "cornerstone_payroll",
          external_pay_period_id: batch.id.to_s, external_payroll_item_id: line.id.to_s, contract_version: "2.0",
          source_time_entry_id: line.source_time_entry_id.to_s, source_user_uuid: line.source_user_uuid,
          source_line_key: line.line_key, source_kind: line.source_kind,
          total_hours: line.total_hours, regular_hours: line.regular_hours, overtime_hours: line.overtime_hours, metadata: metadata
        }.merge(status == "payment_issued" ? { payment_method: "paper_check", payment_reference: "SYNTHETIC-#{batch.id}" } : {}).to_json,
          headers: { "X-Shared-Secret" => ENV.fetch("PAYROLL_SHARED_SECRET"), "Content-Type" => "application/json" }
        expect(response).to have_http_status(:created), response.body
      end
    end
  end

  def lock_then_settle(expected_delta:, expected_total:, expected_manual_lines: [])
    Payroll::SettlementCaseCoordinator.record_entry!(@later.reload) unless @later.destroyed?
    Payroll::SettlementCaseCoordinator.sync_finalized_periods!
    settlement = PayrollSettlementCase.active.find_by!(origin_payroll_batch: @scheduled.payroll_batch, source_time_entry_id: @later.id)
    expect(settlement.target_payroll_calendar_period).to eq(@successor)
    routed = settlement.attributes.deep_dup
    events = settlement.payroll_settlement_case_events.pluck(:id)
    expect(Payroll::ManualCalendarFinalizer.new(period_id: @manual.id, actor: actor, reason: "Accountant is ready to lock").call)
      .to include(status: "finalized")
    @manual.reload
    expect(@manual.payroll_batch.payroll_batch_entries.where(source_time_entry_id: @later.id).pluck(:work_date, :total_hours))
      .to match_array(expected_manual_lines)
    receipts(@manual.payroll_batch)
    expect(settlement.reload.attributes).to eq(routed)
    expect(settlement.payroll_settlement_case_events.pluck(:id)).to eq(events)
    expect(settlement.included_payroll_batch).to be_nil
    expect(@scheduled.payroll_batch.reload.attributes).to eq(@original)

    travel_to(@successor.cutoff_at + 1.minute) do
      expect(Payroll::ScheduledCutoffFinalizer.new(period_id: @successor.id).call).to include(status: "finalized")
      @successor.reload
      lines = @successor.payroll_batch.payroll_batch_entries.where(source_time_entry_id: @later.id)
      expect(lines.pluck(:source_category_id, :total_hours, :regular_hours, :overtime_hours))
        .to match_array(expected_delta)
      expect(settlement.reload).to have_attributes(status: "in_payroll", included_payroll_batch: @successor.payroll_batch,
        target_payroll_calendar_period: @successor)
      receipts(@successor.payroll_batch)
      expect(settlement.reload.status).to eq("in_payroll")
      expect(settlement.included_payroll_batch.payroll_entry_processing_events.where(status: "committed").count).to eq(lines.count)
    end
    expect(PayrollBatchEntry.sum(:total_hours)).to eq(expected_total)
    expect(Payroll::BatchBuilder.new(start_date: "2026-11-16", end_date: "2026-11-30", cutoff_at: @successor.cutoff_at + 1.day).call[:rows])
      .to be_empty
  end

  it "leaves an increased later entry at its named successor through Lock and exact receipts" do
    prepare_periods
    receipts(@scheduled.payroll_batch, statuses: [ "payment_issued" ])
    @later.update!(end_time: guam.local(2026, 10, 16, 18))
    lock_then_settle(expected_delta: [ [ category.id, 2, 2, 0 ] ], expected_total: 18)
    travel_to(@successor.cutoff_at + 2.minutes) { receipts(@successor.payroll_batch, statuses: [ "payment_issued" ]) }
    settlement = PayrollSettlementCase.find_by!(origin_payroll_batch: @scheduled.payroll_batch, source_time_entry_id: @later.id)
    expect(Payroll::SettlementCaseCompletion.new(settlement_case: settlement, entry: @later.reload).call).to eq("paid")
  end

  it "leaves a negative later correction at its named successor" do
    prepare_periods
    receipts(@scheduled.payroll_batch, statuses: [ "payment_issued" ])
    @later.update!(end_time: guam.local(2026, 10, 16, 14))
    lock_then_settle(expected_delta: [ [ category.id, -2, -2, 0 ] ], expected_total: 14)
    expect(@successor.payroll_batch.payload["requires_negative_adjustment_review"]).to eq(true)
    line = @successor.payroll_batch.payroll_batch_entries.sole
    travel_to(@successor.cutoff_at + 2.minutes) do
      receipts(@successor.payroll_batch, statuses: [ "committed" ], metadata: {
        accounting_only: true, correction_disposition_id: "9001", original_pay_period_id: @scheduled.payroll_batch.id.to_s,
        original_payroll_item_id: @scheduled.payroll_batch.payroll_batch_entries.sole.id.to_s,
        corrective_pay_period_id: @successor.payroll_batch.id.to_s, corrective_payroll_item_id: line.id.to_s
      })
    end
    settlement = PayrollSettlementCase.find_by!(origin_payroll_batch: @scheduled.payroll_batch, source_time_entry_id: @later.id)
    expect(Payroll::SettlementCaseCompletion.new(settlement_case: settlement, entry: @later.reload).call).to eq("accounting_recorded")
  end

  it "preserves both signed category legs for the named successor" do
    prepare_periods
    replacement = create(:time_category)
    @later.update!(time_category: replacement)
    lock_then_settle(expected_delta: [ [ category.id, -8, -8, 0 ], [ replacement.id, 8, 8, 0 ] ], expected_total: 16)
  end

  it "preserves a later deletion for the named successor" do
    prepare_periods
    @later.destroy!
    lock_then_settle(expected_delta: [ [ category.id, -8, -8, 0 ] ], expected_total: 8)
  end

  it "does not claim an overnight correction merely because its source ID has earlier-date manual wages" do
    prepare_periods(overnight: true)
    @later.update!(clock_out_at: guam.local(2026, 10, 16, 6), end_time: guam.local(2026, 10, 16, 6))
    lock_then_settle(expected_delta: [ [ category.id, 2, 2, 0 ] ], expected_total: 10,
      expected_manual_lines: [ [ Date.new(2026, 10, 15), 4 ] ])
    expect(@successor.payroll_batch.payroll_batch_entries.pluck(:work_date)).to eq([ Date.new(2026, 10, 16) ])
  end

  it "keeps shared-week overtime correct while deferring an increased later entry" do
    prepare_periods(prefix: true)
    @later.update!(end_time: guam.local(2026, 10, 16, 18))
    review_overtime
    lock_then_settle(expected_delta: [ [ category.id, 2, 0, 2 ] ], expected_total: 50)
    expect([ PayrollBatchEntry.sum(:regular_hours), PayrollBatchEntry.sum(:overtime_hours) ]).to eq([ 40, 10 ])
  end

  [ :pending_overtime, :missing_category ].each do |hold|
    it "keeps a later-only #{hold} review out of the earlier manual batch and its cases" do
      prepare_periods(prefix: true)
      if hold == :pending_overtime
        @earlier.update!(end_time: guam.local(2026, 10, 15, 12))
      else
        # Model retained legacy data; new interactive edits correctly require
        # a category. The real revision trigger still captures this fixture.
        @later.update_columns(time_category_id: nil, lock_version: @later.lock_version + 1, updated_at: Time.current)
      end
      Payroll::SettlementCaseCoordinator.sync_finalized_periods!
      settlement = PayrollSettlementCase.active.find_by!(origin_payroll_batch: @scheduled.payroll_batch, source_time_entry_id: @later.id)
      original = settlement.attributes.deep_dup
      expect(Payroll::ManualCalendarFinalizer.new(period_id: @manual.id, actor: actor, reason: "Freeze only manual-owned hours").call)
        .to include(status: "finalized")
      batch = @manual.reload.payroll_batch
      expect(batch.payroll_batch_entries.where(source_time_entry_id: @later.id)).not_to exist
      expect(batch.payroll_batch_exclusions.where(source_time_entry_id: @later.id)).not_to exist
      expect(batch.issues.fetch("missing_category_count")).to eq(0)
      expect(PayrollSettlementCase.where(origin_payroll_batch: batch, source_time_entry_id: @later.id)).not_to exist
      expect(settlement.reload.attributes).to eq(original)
    end
  end

  [ :scheduled_first, :manual_first ].each do |order|
    it "settles exactly one zero-total REG/OT reclassification at the successor with #{order}" do
      prepare_periods(prefix: true, freeze_scheduled: order == :scheduled_first)
      @earlier.update!(end_time: guam.local(2026, 10, 15, 12))
      review_overtime
      if order == :manual_first
        expect(Payroll::ManualCalendarFinalizer.new(period_id: @manual.id, actor: actor, reason: "Ready before delayed worker").call)
          .to include(status: "finalized")
        freeze_scheduled_period
      end
      lock_then_settle(expected_delta: [ [ category.id, 0, 4, -4 ] ], expected_total: 44)
      expect(@manual.payroll_batch.payroll_batch_entries.sum(:regular_hours)).to eq(36)
      expect(@scheduled.payroll_batch.payroll_batch_entries.sum(:overtime_hours)).to eq(8)
      shifts = @successor.payroll_batch.payroll_batch_entries.where(source_time_entry_id: @later.id)
      expect(shifts.count).to eq(1)
      expect(shifts.sum(:total_hours)).to eq(0)
      expect([ shifts.sum(:regular_hours), shifts.sum(:overtime_hours) ]).to eq([ 4, -4 ])
      expect([ PayrollBatchEntry.sum(:regular_hours), PayrollBatchEntry.sum(:overtime_hours) ]).to eq([ 40, 4 ])
    end
  end
end
