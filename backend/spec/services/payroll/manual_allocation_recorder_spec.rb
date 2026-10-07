# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::ManualAllocationRecorder do
  let(:actor) { create(:user, :admin) }
  let(:employee) { create(:user, :employee) }
  let(:category) { create(:time_category) }
  let(:entry) do
    create(:time_entry, user: employee, time_category: category,
                        work_date: Date.new(2026, 8, 15),
                        entry_method: "manual", status: "completed",
                        approval_status: "approved", approved_at: Time.zone.parse("2026-08-16 10:00"),
                        created_at: Time.zone.parse("2026-08-15 17:00"),
                        updated_at: Time.zone.parse("2026-08-16 10:00"),
                        start_time: Time.utc(2000, 1, 1, 0, 0),
                        end_time: Time.utc(2000, 1, 1, 6, 6))
  end
  let(:recorder) { described_class.new(actor: actor) }

  def commit_hours(payroll_item_id: "1438")
    recorder.commit!(
      entry: entry,
      source_user_uuid: employee.payroll_integration_uuid,
      regular_hours: "6.10",
      overtime_hours: "0.00",
      external_pay_period_id: "68",
      external_payroll_item_id: payroll_item_id,
      pay_date: "2026-09-17",
      reason: "Verified against the issued Cornerstone adjustment check"
    )
  end

  it "keeps manually committed and issued hours out of the next payable preview while preserving the payment trail" do
    allocation = commit_hours

    before_issue = Payroll::BatchBuilder.new(
      start_date: "2026-08-01", end_date: "2026-08-15", cutoff_at: Time.zone.parse("2026-09-18 17:00")
    ).call.fetch(:payload)
    expect(before_issue.fetch(:summary).fetch(:total_hours)).to eq(0.0)
    expect(Payroll::EntryLifecycleResolver.new(entries: [ entry ]).call.dig(entry.id, :status)).to eq("committed")

    recorder.issue!(allocation: allocation, payment_method: "paper_check", payment_reference: "01045",
                    payment_effective_on: "2026-09-16",
                    occurred_at: "2026-09-17T15:00:00+10:00", reason: "Chelsea confirmed physical check delivery")

    expect(allocation.reload.issued_at).to eq(Time.iso8601("2026-09-17T15:00:00+10:00"))
    expect(allocation.payroll_manual_allocation_events.find_by!(event_type: "issued").occurred_at)
      .to eq(allocation.issued_at)
    expect(allocation.payment_effective_on).to eq(Date.new(2026, 9, 16))
    expect(allocation.payroll_manual_allocation_events.find_by!(event_type: "issued").payment_effective_on)
      .to eq(Date.new(2026, 9, 16))

    lifecycle = Payroll::EntryLifecycleResolver.new(entries: [ entry ]).call.fetch(entry.id)
    expect(lifecycle.fetch(:status)).to eq("payment_issued")
    expect(lifecycle.fetch(:payment_reference)).to eq("01045")
    expect(lifecycle.fetch(:payment_effective_on)).to eq("2026-09-16")
    expect(lifecycle.fetch(:settlements).last.fetch(:payment_effective_on)).to eq("2026-09-16")
    expect(lifecycle.fetch(:manually_paid_hours)).to eq(6.1)
    expect(allocation.payroll_manual_allocation_events.pluck(:event_type)).to eq(%w[committed issued])
  end

  it "refuses to over-allocate hours across two payroll items" do
    commit_hours

    expect { commit_hours(payroll_item_id: "1439") }
      .to raise_error(described_class::Error, /exceed the AIRE regular or overtime hours/)
    expect(PayrollManualAllocation.count).to eq(1)
  end

  it "does not invent a payment date when evidence is missing or later than the record" do
    allocation = commit_hours

    expect do
      recorder.issue!(allocation: allocation, payment_method: "paper_check", payment_reference: "01045",
                      payment_effective_on: "", occurred_at: "2026-09-17T15:00:00+10:00",
                      reason: "Check delivery confirmed without a date")
    end.to raise_error(described_class::Error, /Payment date must use YYYY-MM-DD/)
    expect do
      recorder.issue!(allocation: allocation, payment_method: "paper_check", payment_reference: "01045",
                      payment_effective_on: "2026-09-18", occurred_at: "2026-09-17T15:00:00+10:00",
                      reason: "Check delivery confirmed in the future")
    end.to raise_error(described_class::Error, /cannot be after/)
    expect(allocation.reload.status).to eq("committed")
    expect(allocation.payment_effective_on).to be_nil
  end

  it "does not accept a future payment date disguised by a future record timestamp" do
    allocation = commit_hours
    future_time = Time.current + 2.days

    expect do
      recorder.issue!(allocation: allocation, payment_method: "paper_check", payment_reference: "01045",
                      payment_effective_on: future_time.in_time_zone("Pacific/Guam").to_date.iso8601,
                      occurred_at: future_time.iso8601,
                      reason: "Attempted premature check-delivery confirmation")
    end.to raise_error(described_class::Error, /future time/)
    expect(allocation.reload.status).to eq("committed")
    expect(allocation.payment_effective_on).to be_nil
  end

  it "refuses to link the same AIRE entry to the same payroll item twice" do
    commit_hours

    expect { commit_hours }
      .to raise_error(described_class::Error, /already linked/)
    expect(PayrollManualAllocation.count).to eq(1)
  end

  it "protects payment events from direct database mutation" do
    event = commit_hours.payroll_manual_allocation_events.first

    [
      "UPDATE payroll_manual_allocation_events SET reason = 'rewritten' WHERE id = #{event.id}",
      "DELETE FROM payroll_manual_allocation_events WHERE id = #{event.id}",
      "TRUNCATE payroll_manual_allocation_events"
    ].each do |sql|
      expect do
        ActiveRecord::Base.transaction(requires_new: true) { ActiveRecord::Base.connection.execute(sql) }
      end.to raise_error(ActiveRecord::StatementInvalid, /append-only/)
    end
    expect(event.reload.event_type).to eq("committed")
  end

  it "returns voided manual hours to the payable preview and preserves the void event" do
    allocation = commit_hours
    recorder.void!(allocation: allocation, occurred_at: "2026-09-18T15:00:00+10:00",
                   reason: "The linked Cornerstone check was voided")

    expect(allocation.reload.voided_at).to eq(Time.iso8601("2026-09-18T15:00:00+10:00"))
    expect(allocation.payroll_manual_allocation_events.find_by!(event_type: "voided").occurred_at)
      .to eq(allocation.voided_at)

    preview = Payroll::BatchBuilder.new(
      start_date: "2026-08-01", end_date: "2026-08-15", cutoff_at: Time.zone.parse("2026-09-19 17:00")
    ).call.fetch(:payload)
    expect(preview.fetch(:summary).fetch(:total_hours)).to eq(6.1)
    expect(Payroll::EntryLifecycleResolver.new(entries: [ entry ]).call.dig(entry.id, :status)).to eq("payment_voided")
  end

  it "shows a later paid batch instead of an older voided manual link" do
    allocation = commit_hours
    recorder.void!(allocation: allocation, occurred_at: "2026-09-18T15:00:00+10:00",
                   reason: "The linked Cornerstone check was voided")
    batch = create(:payroll_batch, cutoff_at: Time.zone.parse("2026-09-19 17:00"),
                                  finalized_at: Time.zone.parse("2026-09-19 17:00"))
    batch.payroll_batch_entries.create!(
      source_time_entry_id: entry.id, source_user_id: employee.id,
      source_user_uuid: employee.payroll_integration_uuid,
      source_category_id: category.id, work_date: entry.work_date,
      week_start: entry.work_date.beginning_of_week(:sunday),
      total_hours: 6.1, regular_hours: 6.1, overtime_hours: 0,
      source_kind: "carryover", line_key: "category:#{category.id}", snapshot: {}
    )
    batch.payroll_entry_processing_events.create!(
      event_id: SecureRandom.uuid, source_time_entry_id: entry.id,
      source_user_uuid: employee.payroll_integration_uuid,
      status: "payment_issued", external_system: "cornerstone",
      external_pay_period_id: "69", external_payroll_item_id: "1500",
      payment_method: "paper_check", payment_reference: "01046",
      occurred_at: Time.zone.parse("2026-09-20 09:00")
    )

    lifecycle = Payroll::EntryLifecycleResolver.new(entries: [ entry ]).call.fetch(entry.id)
    expect(lifecycle.fetch(:status)).to eq("payment_issued")
    expect(lifecycle.fetch(:payment_reference)).to eq("01046")
  end

  it "does not reoffer delivered hours merely because someone voids their payroll link" do
    allocation = commit_hours
    recorder.issue!(allocation: allocation, payment_method: "paper_check", payment_reference: "01045",
                    payment_effective_on: "2026-09-17",
                    occurred_at: "2026-09-17T15:00:00+10:00", reason: "Chelsea confirmed physical check delivery")

    expect do
      recorder.void!(allocation: allocation, occurred_at: "2026-09-18T15:00:00+10:00",
                     reason: "Payroll link was removed without proof of nonpayment")
    end.to raise_error(described_class::Error, /Issued hours cannot be returned/)
    expect(allocation.reload.status).to eq("issued")
    expect(allocation.payroll_manual_allocation_events.pluck(:event_type)).to eq(%w[committed issued])
  end

  it "requires the exact permanent AIRE employee identity" do
    expect do
      recorder.commit!(entry: entry, source_user_uuid: SecureRandom.uuid,
                       regular_hours: "6.10", overtime_hours: "0.00",
                       external_pay_period_id: "68", external_payroll_item_id: "1438",
                       pay_date: "2026-09-17",
                       reason: "Verified against the issued Cornerstone adjustment check")
    end.to raise_error(described_class::Error, /identity changed/)
  end

  it "accepts weekly overtime with no separate overtime approval when the batch builder includes it" do
    4.times do |offset|
      create(:time_entry, user: employee, time_category: category,
                          work_date: Date.new(2026, 8, 9) + offset,
                          status: "completed", entry_method: "clock", approval_status: nil,
                          created_at: Time.zone.parse("2026-08-09 18:00") + offset.days)
    end
    entry.update_columns(hours: 9.0, overtime_status: "none")
    entry.reload
    preview = Payroll::BatchBuilder.new(
      start_date: "2026-08-01", end_date: "2026-08-15", cutoff_at: Time.zone.parse("2026-09-18 17:00")
    ).call.fetch(:payload)
    adjustment = preview.fetch(:employees).first.fetch(:adjustments).find { |row| row[:source_time_entry_id] == entry.id.to_s }
    expect(adjustment.fetch(:regular_hours)).to eq(8.0)
    expect(adjustment.fetch(:overtime_hours)).to eq(1.0)

    allocation = recorder.commit!(
      entry: entry, source_user_uuid: employee.payroll_integration_uuid,
      regular_hours: "8.00", overtime_hours: "1.00",
      external_pay_period_id: "68", external_payroll_item_id: "1438",
      pay_date: "2026-09-17", reason: "Exact AIRE weekly overtime on the issued check"
    )
    expect(allocation).to have_attributes(regular_hours: 8, overtime_hours: 1)
  end

  it "uses the covering published calendar policy instead of later settings" do
    entry.update_columns(hours: 9, overtime_status: "none")
    create(:payroll_calendar_period, start_date: Date.new(2026, 8, 1), end_date: Date.new(2026, 8, 15),
           pay_date: Date.new(2026, 8, 31), cutoff_at: Time.iso8601("2026-08-24T17:00:00+10:00"),
           overtime_policy: Payroll::WeeklyOvertimeAllocator.configured_policy)
    Setting.set("overtime_daily_threshold_hours", "12")

    allocation = recorder.commit!(entry: entry.reload, source_user_uuid: employee.payroll_integration_uuid,
                                  regular_hours: 9, overtime_hours: 0, external_pay_period_id: "68",
                                  external_payroll_item_id: "frozen-policy", pay_date: "2026-09-17",
                                  reason: "Verified source hours against the published frozen overtime policy")
    expect(allocation).to have_attributes(regular_hours: 9, overtime_hours: 0)
  end

  it "keeps fully allocated uncategorized hours out of a calendar revision snapshot" do
    employee.user_time_categories.create!(time_category: category)
    entry.update_columns(work_date: Date.new(2026, 10, 3), time_category_id: nil, approved_at: Time.current)
    entry.reload
    calendar = create(:payroll_calendar_period, start_date: Date.new(2026, 10, 1), end_date: Date.new(2026, 10, 15),
                      pay_date: Date.new(2026, 10, 31), cutoff_at: Time.iso8601("2026-10-24T17:00:00+10:00"))
    allocation = commit_hours
    expect(allocation.time_category_id).to eq(category.id)
    result = Payroll::BatchBuilder.new(start_date: calendar.start_date, end_date: calendar.end_date,
                                      cutoff_at: calendar.cutoff_at, calendar_period: calendar).call
    expect(result.fetch(:rows)).to be_empty
    expect(result.dig(:summary, :total_hours)).to eq(0.0)
  end

  it "does not create false category reversals for manually paid legacy work after assignments change" do
    employee.user_time_categories.create!(time_category: category)
    entry.update_columns(time_category_id: nil)
    allocation = commit_hours
    employee.user_time_categories.create!(time_category: create(:time_category))

    expect(allocation.time_category_id).to eq(category.id)
    result = Payroll::BatchBuilder.new(start_date: "2026-08-01", end_date: "2026-08-15").call
    expect(result.fetch(:rows)).to be_empty
  end

  it "preserves an unresolved legacy category when exact paid hours are reconciled" do
    other_category = create(:time_category)
    employee.user_time_categories.create!(time_category: category)
    employee.user_time_categories.create!(time_category: other_category)
    entry.update_columns(time_category_id: nil)
    entry.reload

    allocation = commit_hours

    expect(allocation.time_category_id).to be_nil
    expect(entry.reload.time_category_id).to be_nil
    expect(allocation.regular_hours).to eq(6.1)
    expect(Payroll::BatchBuilder.new(start_date: "2026-08-01", end_date: "2026-08-15").call.fetch(:payload)
      .fetch(:summary).fetch(:total_hours)).to eq(0.0)
  end
  def cancel_instrument(allocation, **options)
    recorder.cancel_payment!(allocation: allocation, payment_method: "paper_check", payment_reference: "01045",
      payment_effective_on: "2026-09-16", occurred_at: "2026-09-18T15:00:00+10:00",
      reason: "Bank confirmed stop payment on the original check", cancellation_evidence_reference: "stop-payment-1", **options)
  end

  it "retains reserved hours and immutable payment evidence while a cancelled payment awaits replacement" do
    allocation = commit_hours
    recorder.issue!(allocation: allocation, payment_method: "paper_check", payment_reference: "01045",
      payment_effective_on: "2026-09-16", occurred_at: "2026-09-17T15:00:00+10:00", reason: "Verified physical check delivery")
    original = allocation.payroll_manual_allocation_events.find_by!(event_type: "issued").attributes
    cancel_instrument(allocation)
    expect(allocation.reload).to have_attributes(status: "committed", payment_reference: nil, payment_method: nil,
      issued_at: nil, payment_effective_on: nil, payment_cancelled_at: Time.iso8601("2026-09-18T15:00:00+10:00"))
    expect(allocation.payroll_manual_allocation_events.find_by!(event_type: "issued").attributes).to eq(original)
    expect(allocation.payroll_manual_allocation_events.find_by!(event_type: "payment_cancelled"))
      .to have_attributes(payment_reference: "01045", payment_effective_on: Date.new(2026, 9, 16), cancellation_evidence_reference: "stop-payment-1")
    expect(Payroll::BatchBuilder.new(start_date: "2026-08-01", end_date: "2026-08-15").call.dig(:summary, :total_hours)).to eq(0.0)
    expect(Payroll::EntryLifecycleResolver.new(entries: [ entry ]).call.fetch(entry.id))
      .to include(status: "payment_cancelled", manually_committed_hours: 6.1, manually_paid_hours: 0.0)
    expect(Payroll::EmployeePeriodEvidence.new(user: employee).call.fetch(:totals))
      .to include(committed_hours: 6.1, issued_hours: 0.0, needs_reconciliation_hours: 0.0)
    expect { recorder.issue!(allocation: allocation, payment_method: "paper_check", payment_reference: "01045",
      payment_effective_on: "2026-09-18", occurred_at: "2026-09-18T15:00:00+10:00", reason: "Original check cannot be reused") }
      .to raise_error(described_class::Error, /cancelled instrument/)
    recorder.issue!(allocation: allocation, payment_method: "paper_check", payment_reference: "01046",
      payment_effective_on: "2026-09-18", occurred_at: "2026-09-18T15:00:00+10:00", reason: "Verified replacement payment delivery")
    expect(allocation.reload.status).to eq("issued")
    expect(allocation.payroll_manual_allocation_events.order(:id).pluck(:event_type)).to eq(%w[committed issued payment_cancelled issued])
    expect { cancel_instrument(allocation) }.to raise_error(described_class::Error, /already cancelled/)
    expect(allocation.reload.payment_reference).to eq("01046")
  end

  it "tombstones an unissued committed instrument and increments the optimistic version" do
    allocation = commit_hours
    version = allocation.lock_version
    cancel_instrument(allocation, payment_effective_on: nil)
    expect(allocation.reload.status).to eq("committed")
    expect(allocation.lock_version).to eq(version + 1)
    cancel_instrument(allocation, payment_reference: "01046", payment_effective_on: nil)
    expect(allocation.reload.lock_version).to eq(version + 2)
    expect(PayrollManualAllocation.active.sum("regular_hours + overtime_hours")).to eq(6.1)
    expect { recorder.issue!(allocation: allocation, payment_method: "paper_check", payment_reference: "01045",
      payment_effective_on: "2026-09-18", occurred_at: "2026-09-18T15:00:00+10:00", reason: "Delayed old issuance must be refused") }
      .to raise_error(described_class::Error, /cancelled instrument/)
  end

  it "refuses mismatched, backdated and future cancellation without changing evidence" do
    allocation = commit_hours
    recorder.issue!(allocation: allocation, payment_method: "paper_check", payment_reference: "01045",
      payment_effective_on: "2026-09-16", occurred_at: "2026-09-17T15:00:00+10:00", reason: "Verified physical check delivery")
    [{ payment_reference: "another-check" }, { payment_effective_on: "2026-09-17" },
     { occurred_at: "2026-09-16T15:00:00+10:00" }, { occurred_at: 1.day.from_now.iso8601 },
     { cancellation_evidence_reference: "" }].each do |options|
      expect { cancel_instrument(allocation, **options) }.to raise_error(described_class::Error)
    end
    expect(allocation.reload.status).to eq("issued")
    expect(allocation.payroll_manual_allocation_events.count).to eq(2)
  end

  it "reopens only the settled supplemental case with the exact cancelled payment evidence" do
    allocation = commit_hours
    matched = create(:payroll_settlement_case, source_time_entry_id: entry.id, source_user_id: employee.id,
      source_user_uuid: employee.payroll_integration_uuid, held_total_hours: 6.1,
      destination_kind: "supplemental", status: "in_payroll", target_external_pay_period_id: "68")
    recorder.issue!(allocation: allocation, payment_method: "paper_check", payment_reference: "01045",
      payment_effective_on: "2026-09-16", occurred_at: "2026-09-17T15:00:00+10:00", reason: "Verified physical check delivery")
    expect(matched.reload.status).to eq("settled")
    unrelated = create(:payroll_settlement_case, origin_payroll_batch: matched.origin_payroll_batch,
      origin_reason: "created_after_cutoff", source_time_entry_id: entry.id, source_user_id: employee.id,
      source_user_uuid: employee.payroll_integration_uuid, destination_kind: "supplemental", status: "settled",
      target_external_pay_period_id: "68", resolved_at: Time.current)
    unrelated.payroll_settlement_case_events.create!(event_id: SecureRandom.uuid, event_type: "settled",
      from_status: "in_payroll", to_status: "settled", occurred_at: Time.current,
      metadata: { external_payroll_item_id: "other", payment_method: "paper_check", payment_reference: "other" })
    cancel_instrument(allocation)
    expect(matched.reload).to have_attributes(status: "in_payroll", resolved_at: nil, target_external_pay_period_id: "68")
    expect(matched.payroll_settlement_case_events.order(:id).last.event_type).to eq("payment_cancelled")
    expect(Payroll::SettlementCaseSerializer.new(matched).as_json.dig(:processing, :status)).to eq("payment_cancelled")
    expect(unrelated.reload.status).to eq("settled")
  end

  it "reopens an aggregate manual case when an earlier partial payment is cancelled" do
    settlement = create(:payroll_settlement_case, source_time_entry_id: entry.id, source_user_id: employee.id,
      source_user_uuid: employee.payroll_integration_uuid, held_total_hours: 6.1,
      destination_kind: "supplemental", status: "in_payroll", target_external_pay_period_id: "68")
    parts = [["PART-A", 3], ["PART-B", 3.1]].map do |item, hours|
      recorder.commit!(entry: entry, source_user_uuid: employee.payroll_integration_uuid,
        regular_hours: hours, overtime_hours: 0, external_pay_period_id: "68", external_payroll_item_id: item,
        pay_date: "2026-09-17", reason: "Synthetic reviewed partial source allocation")
    end
    parts.each_with_index do |part, offset|
      recorder.issue!(allocation: part, payment_method: "paper_check", payment_reference: "0104#{5 + offset}",
        payment_effective_on: "2026-09-16", occurred_at: "2026-09-17T15:00:00+10:00", reason: "Synthetic verified partial payment")
    end
    expect(settlement.reload.status).to eq("settled")
    closure = settlement.payroll_settlement_case_events.order(:id).last
    expect(closure.metadata["external_payroll_item_id"]).to eq("PART-B")
    expect(closure.metadata["manual_allocation_component_ids"]).to eq(parts.map { |part| part.id.to_s })
    # Rehearse an older closure retaining only the original manual footprint.
    settlement.payroll_settlement_case_events.create!(closure.attributes.except("id", "created_at", "updated_at").merge(
      event_id: SecureRandom.uuid, metadata: closure.metadata.except("manual_allocation_component_ids", "manual_allocation_components")))
    cancel_instrument(parts.first)
    expect(settlement.reload).to have_attributes(status: "in_payroll", resolved_at: nil, target_external_pay_period_id: "68")
    reopening = settlement.payroll_settlement_case_events.order(:id).last
    expect(reopening.metadata["retained_manual_allocation_component_ids"]).to eq([parts.last.id.to_s])
    expect(reopening.metadata["cancelled_component_committed_hours"]).to eq("3.0")
    expect(parts.last.reload.status).to eq("issued")
    expect(Payroll::EmployeePeriodEvidence.new(user: employee).call[:totals]).to include(issued_hours: 3.1, committed_hours: 3.0)
  end

  it "reopens a cross-period aggregate closure only for an original component recorded before closure" do
    entry.update!(end_time: Time.utc(2000, 1, 1, 8, 0))
    settlement = create(:payroll_settlement_case, source_time_entry_id: entry.id, source_user_id: employee.id,
      source_user_uuid: employee.payroll_integration_uuid, held_total_hours: 8,
      destination_kind: "supplemental", status: "in_payroll", target_external_pay_period_id: "69")
    parts = [["68", "PART-A"], ["69", "PART-B"]].map do |period, item|
      recorder.commit!(entry: entry, source_user_uuid: employee.payroll_integration_uuid,
        regular_hours: 4, overtime_hours: 0, external_pay_period_id: period, external_payroll_item_id: item,
        pay_date: "2026-09-17", reason: "Synthetic reviewed partial source allocation")
    end
    parts.each_with_index do |part, offset|
      recorder.issue!(allocation: part, payment_method: "paper_check", payment_reference: "0104#{5 + offset}",
        payment_effective_on: "2026-09-16", occurred_at: "2026-09-17T15:00:00+10:00", reason: "Synthetic verified partial payment")
    end
    closure = settlement.payroll_settlement_case_events.order(:id).last
    expect(settlement.reload).to have_attributes(status: "settled", target_external_pay_period_id: "69")
    legacy = create(:payroll_settlement_case, origin_payroll_batch: create(:payroll_batch, start_date: "2026-09-16", end_date: "2026-09-30"),
      origin_reason: "created_after_cutoff", source_time_entry_id: entry.id, source_user_id: employee.id,
      source_user_uuid: employee.payroll_integration_uuid, held_total_hours: 8,
      destination_kind: "supplemental", status: "settled", target_external_pay_period_id: "69", resolved_at: Time.current)
    legacy.payroll_settlement_case_events.create!(closure.attributes.except("id", "created_at", "updated_at").merge(
      payroll_settlement_case_id: legacy.id, event_id: SecureRandom.uuid,
      metadata: closure.metadata.except("manual_allocation_component_ids", "manual_allocation_components")))
    cancel_instrument(parts.first)
    [settlement, legacy].each do |matched|
      expect(matched.reload).to have_attributes(status: "in_payroll", resolved_at: nil, target_external_pay_period_id: "69")
      expect(matched.payroll_settlement_case_events.order(:id).last.metadata["retained_manual_allocation_component_ids"])
        .to eq([parts.last.id.to_s])
    end
    expect(Payroll::EmployeePeriodEvidence.new(user: employee).call[:totals]).to include(issued_hours: 4.0, committed_hours: 4.0)
  end

  it "does not reopen a legacy manual closure for an instrument recorded later with a backdated issue time" do
    entry.update!(end_time: Time.utc(2000, 1, 1, 8, 0))
    part_b = recorder.commit!(entry: entry, source_user_uuid: employee.payroll_integration_uuid,
      regular_hours: 4, overtime_hours: 0, external_pay_period_id: "69", external_payroll_item_id: "PART-B",
      pay_date: "2026-09-17", reason: "Synthetic reviewed partial source allocation")
    recorder.issue!(allocation: part_b, payment_method: "paper_check", payment_reference: "01046",
      payment_effective_on: "2026-09-16", occurred_at: "2026-09-17T15:00:00+10:00", reason: "Synthetic verified partial payment")
    settlement = create(:payroll_settlement_case, source_time_entry_id: entry.id, source_user_id: employee.id,
      source_user_uuid: employee.payroll_integration_uuid, held_total_hours: 8,
      destination_kind: "supplemental", status: "settled", target_external_pay_period_id: "69", resolved_at: Time.current)
    settlement.payroll_settlement_case_events.create!(event_id: SecureRandom.uuid, actor: actor,
      event_type: "settled", from_status: "in_payroll", to_status: "settled", occurred_at: Time.current,
      metadata: { external_pay_period_id: "69", external_payroll_item_id: "PART-B", payment_method: "paper_check",
        payment_reference: "01046", physical_issued_at: part_b.issued_at.iso8601,
        reason: "Matched to an issued Cornerstone payment" })
    part_a = recorder.commit!(entry: entry, source_user_uuid: employee.payroll_integration_uuid,
      regular_hours: 4, overtime_hours: 0, external_pay_period_id: "68", external_payroll_item_id: "PART-A",
      pay_date: "2026-09-17", reason: "Synthetic reviewed later source allocation")
    recorder.issue!(allocation: part_a, payment_method: "paper_check", payment_reference: "01045",
      payment_effective_on: "2026-09-16", occurred_at: "2026-09-17T15:00:00+10:00", reason: "Synthetic backdated physical payment")
    cancel_instrument(part_a)
    expect(settlement.reload.status).to eq("settled")
    expect(settlement.payroll_settlement_case_events.count).to eq(1)
  end

end
