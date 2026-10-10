# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::CarryoverQueue do
  include ActiveSupport::Testing::TimeHelpers

  around { |example| travel_to(Time.utc(2026, 10, 1)) { example.run } }

  let(:employee) { create(:user, :employee) }
  let(:category) { create(:time_category) }

  def entry(date:, hours: 9, approval_status: nil, overtime_status: "denied")
    create(:time_entry, user: employee, time_category: category,
                        work_date: date, entry_method: "clock", approval_status: approval_status,
                        overtime_status: overtime_status,
                        start_time: Time.utc(2000, 1, 1, 0), end_time: Time.utc(2000, 1, 1, 0) + hours.hours)
  end

  def exclude(record, reason: "denied_overtime")
    period_start = Date.new(2026, 9, 1).next_month(PayrollBatch.count)
    create(:payroll_batch, start_date: period_start, end_date: period_start.change(day: 15)).payroll_batch_exclusions.create!(
      source_time_entry_id: record.id, source_user_id: employee.id,
      reason: reason, held_total_hours: record.hours,
      held_regular_hours: 0, held_overtime_hours: record.hours, snapshot: {}
    )
  end

  def read_queue
    writes = []
    subscriber = ->(*args) { writes << args.last[:sql] if args.last[:sql].match?(/\A\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i) }
    result = ActiveSupport::Notifications.subscribed(subscriber, "sql.active_record") { described_class.new.call }
    expect(writes).to be_empty
    result
  end

  def case_for(record, exclusion)
    create(:payroll_settlement_case, origin_payroll_batch: exclusion.payroll_batch,
           origin_payroll_batch_exclusion: exclusion, source_time_entry_id: record.id,
           source_user_id: employee.id, source_user_uuid: employee.payroll_integration_uuid,
           origin_reason: exclusion.reason, original_work_date: record.work_date)
  end

  context "with only historical denied approval" do
    let(:target) { entry(date: Date.new(2026, 5, 4), hours: 4, approval_status: "approved", overtime_status: "none") }
    let!(:exclusion) { exclude(target, reason: "denied_approval") }

    { "denied" => "not_payable", "pending" => "awaiting_approval", "approved" => "needs_review" }.each do |approval, status|
      it "uses current #{approval} approval without altering the historical denial" do
        target.update!(approval_status: approval)
        before = [ target.reload.attributes, exclusion.reload.attributes ]
        result = read_queue
        expect(result.fetch(:items).sole).to include(status: status, exclusion_reason: "denied_approval")
        expect(result.fetch(:summary)).to include("#{status}_count".to_sym => 1, ready_for_next_batch_count: 0)
        expect([ target.reload.attributes, exclusion.reload.attributes ]).to eq(before)
      end
    end

    it "holds resubmitted manual time that has no current approval" do
      target.update_columns(entry_method: "manual", approval_status: nil)
      expect(read_queue.fetch(:items).sole.fetch(:status)).to eq("awaiting_approval")
    end

    it "keeps a deleted source entry not payable" do
      target.destroy!
      expect(read_queue.fetch(:items).sole.fetch(:status)).to eq("not_payable")
    end

    it "requires review until an operator routes the approved entry to a regular period" do
      settlement_case = case_for(target, exclusion)
      future = create(:payroll_calendar_period, start_date: Date.new(2026, 11, 1), end_date: Date.new(2026, 11, 15))
      Payroll::SettlementCaseCoordinator.prepare_for_period!(future)
      expect(settlement_case.reload).to have_attributes(status: "open", destination_kind: "unassigned")
      expect(PayrollBatchExclusion::CARRYOVER_REASONS).not_to include("denied_approval")
      expect(Payroll::SettlementCaseCoordinator::AUTO_ROUTE_REASONS).not_to include("denied_approval")
      preview_args = { start_date: future.start_date, end_date: future.end_date, cutoff_at: future.cutoff_at, calendar_period: future }
      before_preview = Payroll::BatchBuilder.new(**preview_args).call
      expect(before_preview.fetch(:rows)).to be_empty
      expect(read_queue.fetch(:items).sole.fetch(:status)).to eq("needs_review")
      expect(Payroll::BatchBuilder.new(**preview_args).call).to eq(before_preview)
      Payroll::SettlementCaseRouter.new(
        settlement_case: settlement_case, destination_kind: "regular",
        target_external_pay_period_id: future.external_pay_period_id,
        action_due_on: future.pay_date, assigned_to_id: nil,
        reason: "Reviewed historical denial and payment history", actor: create(:user, :admin)
      ).call
      routed_preview = Payroll::BatchBuilder.new(**preview_args).call
      expect(routed_preview.fetch(:rows).sole).to include(total_hours: 4.0, regular_hours: 4.0, overtime_hours: 0.0)
      expect(read_queue.fetch(:items).sole).to include(status: "ready_for_next_batch", included_batch: nil)
      expect(Payroll::BatchBuilder.new(**preview_args).call).to eq(routed_preview)
      expect(exclusion.reload.reason).to eq("denied_approval")
    end

    it "respects an explicit not-payable decision despite current approval" do
      settlement_case = case_for(target, exclusion)
      Payroll::SettlementCaseRouter.new(
        settlement_case: settlement_case, destination_kind: "not_payable", target_external_pay_period_id: nil,
        action_due_on: nil, assigned_to_id: nil, reason: "Verified these hours are not payable", actor: create(:user, :admin)
      ).call
      expect(read_queue.fetch(:items).sole.fetch(:status)).to eq("not_payable")
    end

    it "exposes the retained closed decision without creating an Activity History backfill" do
      settlement_case = case_for(target, exclusion)
      reviewer = create(:user, :admin)
      note = "Duplicate training input; no wages owed for this record"
      settlement_case.update!(status: "not_payable", destination_kind: "not_payable", resolution_note: note, resolved_at: Time.current)
      event = settlement_case.payroll_settlement_case_events.create!(event_id: SecureRandom.uuid, event_type: "marked_not_payable",
        from_status: "open", to_status: "not_payable", actor: reviewer, actor_payroll_integration_uuid: reviewer.payroll_integration_uuid,
        occurred_at: Time.current, metadata: { "reason" => note, "destination_kind" => "not_payable" })
      before = [ target.reload.attributes, exclusion.reload.attributes, settlement_case.reload.attributes ]
      item = read_queue.fetch(:items).sole
      expect(item.fetch(:settlement_case)).to include(resolution_note: note,
        decision: include(event_id: event.event_id, event_type: "marked_not_payable", occurred_at: event.occurred_at.iso8601,
          reason: note, actor: include(name: reviewer.full_name)))
      expect(item[:completion]).to be_nil
      expect(read_queue.fetch(:summary)).to include(unresolved_count: 0, paid_count: 0, not_payable_count: 1)
      expect(AuditLog.where(action: "payroll_settlement_case.marked_not_payable")).to be_empty
      expect([ target.reload.attributes, exclusion.reload.attributes, settlement_case.reload.attributes ]).to eq(before)
    end

    { "denied" => "not_payable", "pending" => "awaiting_approval", "approved" => "scheduled_supplemental" }.each do |approval, status|
      it "keeps current #{approval} approval authoritative for an unprocessed supplemental destination" do
        settlement_case = case_for(target, exclusion)
        Payroll::SettlementCaseRouter.new(
          settlement_case: settlement_case, destination_kind: "supplemental",
          target_external_pay_period_id: "reviewed-supplemental", action_due_on: Date.new(2026, 10, 10),
          assigned_to_id: nil, reason: "Reviewed historical denial", actor: create(:user, :admin)
        ).call
        target.update!(approval_status: approval)
        expect(read_queue.fetch(:items).sole).to include(status: status, included_batch: nil)
      end
    end

    it "retains exact supplemental processing through verified issuance" do
      settlement_case = case_for(target, exclusion)
      admin = create(:user, :admin)
      Payroll::SettlementCaseRouter.new(
        settlement_case: settlement_case, destination_kind: "supplemental",
        target_external_pay_period_id: "reviewed-supplemental", action_due_on: Date.new(2026, 10, 10),
        assigned_to_id: nil, reason: "Reviewed historical denial", actor: admin
      ).call
      %w[imported committed payment_prepared payment_issued].each do |status|
        Payroll::SettlementCaseAcknowledger.new(
          settlement_case: settlement_case, event_type: status, occurred_at: Time.current.iso8601,
          actor: admin, metadata: { payment_reference: "reviewed-check" }
        ).call
        expect(read_queue.fetch(:items).sole).to include(status: status, included_batch: nil)
      end
    end

    { "committed" => { 4 => "committed", 3 => "partially_allocated" },
      "issued" => { 4 => "payment_issued", 3 => "partially_paid" } }.each do |allocation_status, hour_states|
      hour_states.each do |hours, status|
        it "preserves #{hours} hours of #{allocation_status} manual coverage" do
          manual_allocation(target, status: allocation_status, hours: hours)
          expect(read_queue.fetch(:items).sole).to include(status: status, included_batch: nil)
        end
      end
    end

    it "preserves an owner payment evidence hold" do
      PayrollPaymentAttestation.create!(
        time_entry: target, user: employee, recorded_by: create(:user, :admin),
        source_user_uuid: employee.payroll_integration_uuid, source_time_entry_version: target.lock_version,
        work_date: target.work_date, hours: 4, reason: "Owner confirmed printed checks", attested_at: Time.current
      )
      expect(read_queue.fetch(:items).sole.fetch(:status)).to eq("payment_attested_pending_evidence")
    end

    [ nil, *PayrollEntryProcessingEvent::STATUSES ].each do |processing_status|
      it "preserves later batch #{processing_status || 'awaiting Cornerstone'} state" do
        later_batch = create(:payroll_batch, start_date: Date.new(2026, 10, 1), end_date: Date.new(2026, 10, 15),
                            cutoff_at: Time.utc(2026, 10, 18))
        row = later_batch.payroll_batch_entries.create!(
          source_time_entry_id: target.id, source_user_id: employee.id,
          source_user_uuid: employee.payroll_integration_uuid, source_category_id: category.id,
          work_date: target.work_date, week_start: target.work_date.beginning_of_week(:sunday),
          source_kind: "carryover", line_key: "category:#{category.id}",
          total_hours: 4, regular_hours: 4, overtime_hours: 0, snapshot: {}
        )
        if processing_status
          PayrollEntryProcessingEvent.create!(
            payroll_batch: later_batch, event_id: SecureRandom.uuid,
            source_time_entry_id: row.source_time_entry_id, source_user_uuid: row.source_user_uuid,
            contract_version: "2.0", source_line_key: row.line_key, source_kind: row.source_kind,
            total_hours: 4, regular_hours: 4, overtime_hours: 0,
            status: processing_status, external_system: "cornerstone_payroll", occurred_at: Time.current
          )
        end
        item = read_queue.fetch(:items).sole
        expect(item.fetch(:status)).to eq(processing_status || "awaiting_cornerstone")
        expect(item.fetch(:included_batch)).to include(id: later_batch.public_id)
        if processing_status == "payment_issued"
          expect(item.dig(:included_batch, :processing)).to include(paid_hours: 4.0, outstanding_hours: 0.0)
        end
      end
    end
  end

  context "with retained, exactly paid carryover history" do
    let(:target) { entry(date: Date.new(2026, 5, 4), hours: 4, approval_status: "approved", overtime_status: "none") }
    let(:exclusion) { exclude(target, reason: "pending_approval") }
    let(:historical) { case_for(target, exclusion) }
    let(:included) { create(:payroll_batch, start_date: Date.new(2026, 10, 1), end_date: Date.new(2026, 10, 15), cutoff_at: Time.utc(2026, 10, 18)) }
    let(:frozen) do
      included.payroll_batch_entries.create!(source_time_entry_id: target.id, source_user_id: employee.id, source_user_uuid: employee.payroll_integration_uuid,
        source_category_id: category.id, work_date: target.work_date, week_start: target.work_date.beginning_of_week(:sunday), source_kind: "carryover", line_key: "paid-history",
        total_hours: 4, regular_hours: 4, overtime_hours: 0, snapshot: { "version" => target.lock_version })
    end

    before do
      historical.update!(status: "in_payroll", included_payroll_batch: included, destination_kind: "supplemental", target_external_pay_period_id: "destination")
      PayrollEntryProcessingEvent.create!(payroll_batch: included, source_time_entry_id: target.id, source_user_uuid: employee.payroll_integration_uuid,
        contract_version: "2.0", source_line_key: frozen.line_key, source_kind: frozen.source_kind, total_hours: 4, regular_hours: 4, overtime_hours: 0,
        event_id: SecureRandom.uuid, external_system: "cornerstone_payroll", external_pay_period_id: "destination", external_payroll_item_id: "paid-item",
        status: "payment_issued", occurred_at: Time.current, payment_method: "paper_check", payment_reference: "30001")
    end

    it "keeps the paid card and retained case while removing it from unfinished payroll counts" do
      before = historical.attributes.deep_dup
      evidence = read_queue
      expect(evidence[:items].sole).to include(status: "payment_issued", completion: "paid")
      expect(evidence[:summary]).to include(in_payroll_count: 0, unresolved_count: 0, paid_count: 1, accounting_recorded_count: 0)
      expect(historical.reload.attributes).to eq(before)
    end

    it "keeps an ambiguous foreign-owner frozen line requiring review instead of completing the matching paid line" do
      stranger = create(:user, :employee)
      included.payroll_batch_entries.create!(source_time_entry_id: target.id, source_user_id: stranger.id, source_user_uuid: stranger.payroll_integration_uuid,
        source_category_id: category.id, work_date: target.work_date, week_start: target.work_date.beginning_of_week(:sunday), source_kind: "carryover", line_key: "foreign-history",
        total_hours: 4, regular_hours: 4, overtime_hours: 0, snapshot: { "version" => target.lock_version })
      evidence = read_queue
      expect(evidence[:items].sole).to include(completion: nil)
      expect(evidence[:summary]).to include(unresolved_count: 1, paid_count: 0)
    end

    it "does not treat a nominal issued status with a stale current version as completed history" do
      target.update!(description: "Later revision")
      evidence = read_queue
      expect(evidence[:items].sole).to include(completion: nil)
      expect(evidence[:summary]).to include(unresolved_count: 1, paid_count: 0, needs_review_count: 1)
    end
  end

  it "resurfaces a daily-only denied exclusion even without an earlier carryover exclusion" do
    target = entry(date: Date.new(2026, 5, 4))
    exclusion = exclude(target)
    result = described_class.new.call
    expect(result.fetch(:items).sole).to include(status: "needs_review", exclusion_reason: "denied_overtime")
    expect(result.fetch(:summary)).to include(ready_for_next_batch_count: 0, needs_review_count: 1, not_payable_count: 0)
    expect(exclusion.reload.reason).to eq("denied_overtime")
    expect(target.reload.overtime_status).to eq("denied")
  end

  def manual_allocation(record, status:, hours:)
    PayrollManualAllocation.create!(
      time_entry: record, user: employee, time_category: category, recorded_by: create(:user, :admin),
      source_user_uuid: employee.payroll_integration_uuid, source_time_entry_version: record.lock_version,
      work_date: record.work_date, pay_date: Date.new(2026, 9, 30),
      external_pay_period_id: "manual-period", external_payroll_item_id: SecureRandom.uuid,
      regular_hours: hours, overtime_hours: 0, status: status, reason: "Verified historical payroll",
      issued_at: status == "issued" ? Time.current : nil,
      payment_effective_on: status == "issued" ? Date.current : nil
    )
  end

  it "shows fully issued manual hours as paid without a later batch or case" do
    target = entry(date: Date.new(2026, 5, 4))
    exclude(target)
    allocation = manual_allocation(target, status: "issued", hours: 9)
    item = described_class.new.call.fetch(:items).sole
    expect(item).to include(status: "payment_issued", included_batch: nil, settlement_case: nil)
    expect(item.fetch(:payroll_lifecycle)).to include(manually_paid_hours: 9.0)
    expect(allocation.reload.status).to eq("issued")
  end

  it "retains fully issued current manual receipt evidence as completed history" do
    target = entry(date: Date.new(2026, 5, 4), hours: 4, approval_status: "approved", overtime_status: "none")
    exclude(target, reason: "pending_approval")
    allocation = manual_allocation(target, status: "issued", hours: 4)
    allocation.update!(payment_method: "paper_check", payment_reference: "30010")
    evidence = read_queue
    expect(evidence[:items].sole).to include(status: "payment_issued", completion: "paid")
    expect(evidence[:summary]).to include(unresolved_count: 0, in_payroll_count: 0, paid_count: 1)
    target.update!(description: "New revision")
    expect(read_queue[:items].sole).to include(completion: nil)
  end

  it "keeps negative accounting history separate from paid and retains review after original cancellation" do
    target = entry(date: Date.new(2026, 5, 4), hours: 4, approval_status: "approved", overtime_status: "none")
    exclusion = exclude(target, reason: "pending_approval")
    origin = exclusion.payroll_batch
    original = origin.payroll_batch_entries.create!(source_time_entry_id: target.id, source_user_id: employee.id,
      source_user_uuid: employee.payroll_integration_uuid, source_category_id: category.id, work_date: target.work_date,
      week_start: target.work_date.beginning_of_week(:sunday), source_kind: "current", line_key: "original-accounting", total_hours: 4, regular_hours: 4, overtime_hours: 0, snapshot: { "version" => 0 })
    receipt_attributes = { payroll_batch: origin, source_time_entry_id: target.id, source_user_uuid: employee.payroll_integration_uuid,
      contract_version: "2.0", source_line_key: original.line_key, source_kind: "current", total_hours: 4, regular_hours: 4, overtime_hours: 0,
      external_system: "cornerstone_payroll", external_pay_period_id: "10", external_payroll_item_id: "11", occurred_at: Time.current,
      payment_method: "paper_check", payment_reference: "30000" }
    PayrollEntryProcessingEvent.create!(**receipt_attributes, event_id: SecureRandom.uuid, status: "payment_issued")
    target.update!(end_time: target.start_time + 3.hours)
    included = create(:payroll_batch, start_date: Date.new(2026, 10, 1), end_date: Date.new(2026, 10, 15), cutoff_at: Time.utc(2026, 10, 18))
    delta = included.payroll_batch_entries.create!(source_time_entry_id: target.id, source_user_id: employee.id,
      source_user_uuid: employee.payroll_integration_uuid, source_category_id: category.id, work_date: target.work_date,
      week_start: target.work_date.beginning_of_week(:sunday), source_kind: "correction", line_key: "negative-accounting", total_hours: -1, regular_hours: -1, overtime_hours: 0, snapshot: { "version" => target.lock_version })
    historical = create(:payroll_settlement_case, origin_payroll_batch: origin, included_payroll_batch: included,
      source_time_entry_id: target.id, source_user_id: employee.id, source_user_uuid: employee.payroll_integration_uuid,
      source_time_entry_version: target.lock_version, original_work_date: target.work_date, origin_reason: "changed_after_cutoff", status: "in_payroll",
      destination_kind: "supplemental", target_external_pay_period_id: "44")
    PayrollEntryProcessingEvent.create!(payroll_batch: included, source_time_entry_id: target.id, source_user_uuid: employee.payroll_integration_uuid,
      contract_version: "2.0", source_line_key: delta.line_key, source_kind: "correction", total_hours: -1, regular_hours: -1, overtime_hours: 0,
      event_id: SecureRandom.uuid, external_system: "cornerstone_payroll", external_pay_period_id: "44", external_payroll_item_id: "55", status: "committed", occurred_at: Time.current,
      metadata: { "accounting_only" => true, "correction_disposition_id" => "9", "original_pay_period_id" => "10", "original_payroll_item_id" => "11", "corrective_pay_period_id" => "44", "corrective_payroll_item_id" => "55" })
    evidence = read_queue
    expect(evidence[:items].sole).to include(status: "committed", completion: "accounting_recorded")
    expect(evidence[:summary]).to include(unresolved_count: 0, paid_count: 0, accounting_recorded_count: 1, in_payroll_count: 0)
    PayrollEntryProcessingEvent.create!(**receipt_attributes, event_id: SecureRandom.uuid, status: "payment_cancelled")
    expect(read_queue[:items].sole).to include(completion: nil)
    expect(read_queue[:summary]).to include(unresolved_count: 1, accounting_recorded_count: 0, needs_review_count: 1)
    expect(historical.reload.status).to eq("in_payroll")
  end

  it "preserves full and partial manual reservations instead of offering the hours again" do
    target = entry(date: Date.new(2026, 5, 4))
    exclude(target)
    allocation = manual_allocation(target, status: "committed", hours: 9)
    expect(described_class.new.call.fetch(:items).sole.fetch(:status)).to eq("committed")
    allocation.update!(regular_hours: 8)
    expect(described_class.new.call.fetch(:items).sole.fetch(:status)).to eq("partially_allocated")
    allocation.update!(status: "issued", issued_at: Time.current, payment_effective_on: Date.current)
    item = described_class.new.call.fetch(:items).sole
    expect(item.fetch(:status)).to eq("partially_paid")
    expect(item.fetch(:payroll_lifecycle)).to include(manually_paid_hours: 8.0)
  end

  it "retains the owner payment evidence hold before historical routing" do
    target = entry(date: Date.new(2026, 5, 4))
    exclude(target)
    PayrollPaymentAttestation.create!(
      time_entry: target, user: employee, recorded_by: create(:user, :admin),
      source_user_uuid: employee.payroll_integration_uuid, source_time_entry_version: target.lock_version,
      work_date: target.work_date, hours: 9, reason: "Owner confirmed printed checks", attested_at: Time.current
    )
    expect(described_class.new.call.fetch(:items).sole.fetch(:status)).to eq("payment_attested_pending_evidence")
  end

  it "requires an explicit destination and then includes only the unpaid regular delta" do
    target = entry(date: Date.new(2026, 5, 4))
    exclusion = exclude(target)
    batch = exclusion.payroll_batch
    origin = create(:payroll_calendar_period, start_date: batch.start_date, end_date: batch.end_date,
                    status: "finalized", payroll_batch: batch, finalized_at: batch.finalized_at)
    original_policy = origin.overtime_policy.deep_dup
    batch.payroll_batch_entries.create!(
      source_time_entry_id: target.id, source_user_id: employee.id,
      source_user_uuid: employee.payroll_integration_uuid, source_category_id: category.id,
      work_date: target.work_date, week_start: target.work_date.beginning_of_week(:sunday),
      source_kind: "current", line_key: "category:#{category.id}",
      total_hours: 8, regular_hours: 8, overtime_hours: 0, snapshot: {}
    )
    future = create(:payroll_calendar_period, start_date: Date.new(2026, 11, 1), end_date: Date.new(2026, 11, 15))
    admin = create(:user, :admin)
    Payroll::SettlementCaseCoordinator.finalize_period!(period: origin, batch: batch, actor: admin)
    settlement_case = PayrollSettlementCase.find_by!(source_time_entry_id: target.id)
    Payroll::SettlementCaseCoordinator.prepare_for_period!(future)
    expect(settlement_case.reload).to have_attributes(status: "open", destination_kind: "unassigned")
    expect(described_class.new.call.fetch(:items).sole.fetch(:status)).to eq("needs_review")
    Payroll::SettlementCaseRouter.new(
      settlement_case: settlement_case, destination_kind: "regular",
      target_external_pay_period_id: future.external_pay_period_id,
      action_due_on: future.pay_date, assigned_to_id: nil,
      reason: "Reviewed previous 8 regular hours; pay remaining 1 regular hour", actor: admin
    ).call
    expect(described_class.new.call.fetch(:items).sole.fetch(:status)).to eq("ready_for_next_batch")
    preview = Payroll::BatchBuilder.new(start_date: future.start_date, end_date: future.end_date,
                                       cutoff_at: future.cutoff_at, calendar_period: future).call
    adjustment = preview.fetch(:rows).sole
    expect(adjustment).to include(total_hours: 1.0, regular_hours: 1.0, overtime_hours: 0.0)
    expect(batch.payroll_batch_entries.sole.reload.regular_hours).to eq(8)
    expect(origin.reload.overtime_policy).to eq(original_policy)
    expect(exclusion.reload.reason).to eq("denied_overtime")
    expect(target.reload.overtime_status).to eq("denied")
  end

  [ "denied_overtime", "pending_approval" ].each do |historical_reason|
    it "tracks explicitly routed supplemental #{historical_reason} hours without promising a regular cutoff" do
      target = entry(date: Date.new(2026, 5, 4))
      exclusion = exclude(target, reason: historical_reason)
      settlement_case = create(:payroll_settlement_case, origin_payroll_batch: exclusion.payroll_batch,
                               origin_payroll_batch_exclusion: exclusion, source_time_entry_id: target.id,
                               source_user_id: employee.id, source_user_uuid: employee.payroll_integration_uuid,
                               origin_reason: historical_reason, original_work_date: target.work_date)
      Payroll::SettlementCaseRouter.new(
        settlement_case: settlement_case, destination_kind: "supplemental",
        target_external_pay_period_id: "supplemental-historical-correction",
        action_due_on: Date.new(2026, 10, 10), assigned_to_id: nil,
        reason: "Reviewed payment history; settle in a separate supplemental run", actor: create(:user, :admin)
      ).call
      result = described_class.new.call
      expect(result.fetch(:items).sole).to include(status: "scheduled_supplemental", included_batch: nil)
      expect(result.fetch(:summary)).to include(ready_for_next_batch_count: 0, in_payroll_count: 1)
      expect(settlement_case.reload.target_payroll_calendar_period).to be_nil
      expect(target.reload.overtime_status).to eq("denied")
    end
  end

  it "continues to hold genuine denied weekly overtime while retaining historical evidence" do
    5.times { |offset| entry(date: Date.new(2026, 5, 3) + offset, hours: 8, overtime_status: "approved") }
    target = entry(date: Date.new(2026, 5, 8), hours: 2)
    exclude(target)
    expect(described_class.new.call.fetch(:items).sole.fetch(:status)).to eq("not_payable")
  end

  it "keeps denied ordinary approval exclusions not payable" do
    target = entry(date: Date.new(2026, 5, 4), approval_status: "denied", overtime_status: "none")
    exclude(target, reason: "pending_approval")
    exclude(target, reason: "denied_approval")
    expect(described_class.new.call.fetch(:items).sole.fetch(:status)).to eq("not_payable")
  end
end
