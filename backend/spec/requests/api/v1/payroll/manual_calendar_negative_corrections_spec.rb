# frozen_string_literal: true

require "rails_helper"
require_relative "../../../../support/payroll_clock_helpers"

RSpec.describe "Manual calendar Lock with negative corrections", type: :request do
  include ActiveSupport::Testing::TimeHelpers
  include PayrollClockHelpers

  let(:guam) { ActiveSupport::TimeZone["Pacific/Guam"] }
  let(:actor) { create(:user, :admin) }
  let(:category) { create(:time_category) }
  let(:reason) { "Freeze the reviewed October source for Payroll import" }
  let(:secret) { "manual-calendar-correction-secret" }
  let(:headers) do
    grant = PayrollIntegrationGrant.issue!(user: actor, capabilities: [ "payroll_finalization" ])
    { "X-Shared-Secret" => secret, "Content-Type" => "application/json",
      "X-Aire-Delegation-Token" => grant.issued_token }
  end

  around do |example|
    previous = ENV["PAYROLL_SHARED_SECRET"]
    ENV["PAYROLL_SHARED_SECRET"] = secret
    example.run
  ensure
    ENV["PAYROLL_SHARED_SECRET"] = previous
  end

  def publish(second_half: false)
    Payroll::CalendarPeriodPublisher.new({
      schema_version: "2.0", external_pay_period_id: second_half ? "negative-oct-b" : "negative-oct-a",
      start_date: second_half ? "2026-10-16" : "2026-10-01", end_date: second_half ? "2026-10-31" : "2026-10-15",
      pay_date: second_half ? "2026-11-15" : "2026-10-31",
      previous_regular_pay_date: second_half ? "2026-10-31" : "2026-10-15",
      cutoff_at: second_half ? "2026-11-07T17:00:00+10:00" : "2026-10-22T17:00:00+10:00",
      cutoff_rule: "after_previous_regular_payday", cutoff_days: 7, schedule_version: 1,
      publication_id: SecureRandom.uuid
    }, now: guam.local(2026, 10, 24, 12)).call.period
  end

  [ :hours_reduction, :category_reclassification ].each do |correction_kind|
    it "freezes #{correction_kind} through the existing Lock command with required Payroll review and no later reclaim" do
      entry = create(:time_entry, user: create(:user, :employee), time_category: category,
        work_date: "2026-09-20", start_time: guam.local(2026, 9, 20, 8), end_time: guam.local(2026, 9, 20, 16),
        entry_method: "manual", approval_status: "approved", approved_at: Time.current, overtime_status: "none")
      # The database revision clock must place the eight-hour snapshot before the correction.
      origin = create(:payroll_calendar_period, start_date: "2026-09-16", end_date: "2026-09-30",
        pay_date: database_clock.to_date + 7.days, cutoff_at: capture_payroll_cutoff)
      expect(Payroll::ScheduledCutoffFinalizer.new(period_id: origin.id).call[:status]).to eq("finalized")
      origin_batch = origin.reload.payroll_batch
      expect(origin_batch.payroll_batch_entries.sole.total_hours).to eq(8)
      frozen_origin = [ origin.attributes.deep_dup, origin_batch.attributes.deep_dup,
        origin_batch.payroll_batch_entries.map(&:attributes), origin.payroll_outbox_events.map(&:attributes) ]

      PayrollLockRollout.configure!(starts_on: "2026-10-16", actor: "test operator", reason: "Approved rollout decision")
      manual = publish
      expect(database_clock).to be > manual.cutoff_at
      replacement = correction_kind == :category_reclassification ? create(:time_category) : category
      entry.update!(end_time: guam.local(2026, 9, 20, correction_kind == :hours_reduction ? 14 : 16),
        time_category: replacement, approval_status: "pending", approved_at: nil, approved_by: nil)
      TimeClockService.approve_entry(entry: entry, approved_by: actor, note: "Verified corrected source time")
      expect(entry.reload).to have_attributes(approval_status: "approved", hours: correction_kind == :hours_reduction ? 6 : 8)
      Payroll::SettlementCaseCoordinator.record_entry!(entry)
      settlement = PayrollSettlementCase.find_by!(source_time_entry_id: entry.id)
      expect(settlement).to have_attributes(origin_payroll_batch: origin_batch, origin_reason: "changed_after_cutoff")
      Payroll::SettlementCaseRouter.new(settlement_case: settlement, destination_kind: "regular",
        target_external_pay_period_id: manual.external_pay_period_id, action_due_on: nil, assigned_to_id: nil,
        reason: "Settle the approved correction in the manual October period", actor: actor).call
      expect(settlement.reload.target_payroll_calendar_period).to eq(manual)

      command = { command_id: SecureRandom.uuid, expected_version: manual.reload.lock_version, reason: reason }
      path = "/api/v1/payroll/cockpit/periods/#{manual.external_pay_period_id}/finalize"
      post path, params: command.to_json, headers: headers
      expect(response).to have_http_status(:accepted)
      expect(response.parsed_body.dig("result", "status")).to eq("finalized"), response.body
      batch = manual.reload.payroll_batch
      corrections = batch.payroll_batch_entries.where(source_time_entry_id: entry.id)
      expected_rows = correction_kind == :hours_reduction ? [ [ category.id, -2.0 ] ] : [ [ category.id, -8.0 ], [ replacement.id, 8.0 ] ]
      expect(corrections.pluck(:source_category_id, :total_hours)).to match_array(expected_rows)
      expect(corrections.pluck(:source_kind).uniq).to eq([ "correction" ])
      expect(batch.summary["total_hours"]).to eq(correction_kind == :hours_reduction ? -2.0 : 0.0)
      expect(batch.issues).to include("negative_adjustment_count" => 1)
      expect(batch.payload).to include("requires_negative_adjustment_review" => true)
      expect(batch.payload).not_to have_key("negative_adjustment_acknowledgement")
      expect(batch.finalized_by).to eq(actor)
      audit = AuditLog.find_by!(action: "payroll_batch.finalized", auditable: batch)
      expect(audit.user).to eq(actor)
      expect(audit.metadata).to include("manual_calendar_lock" => true, "calendar_lock_reason" => reason)
      expect(audit.metadata).not_to have_key("negative_adjustment_note")
      expect(AuditLog.find_by!(action: "payroll_calendar_period.finalized", auditable: manual).metadata).to include("reason" => reason)
      expect(settlement.reload).to have_attributes(origin_payroll_batch: origin_batch, included_payroll_batch: batch)
      expect(batch.export_payload).to include("requires_negative_adjustment_review" => true)
      expect(Payroll::CanonicalPayload.checksum(batch.payload)).to eq(batch.checksum)

      post path, params: command.to_json, headers: headers
      expect(response).to have_http_status(:accepted)
      expect(response.parsed_body.dig("command", "replayed")).to be(true)
      expect(manual.reload.payroll_batch).to eq(batch)
      expect(manual.payroll_outbox_events.count).to eq(1)
      frozen_manual = batch.attributes.deep_dup
      scheduled = publish(second_half: true)
      travel_to(scheduled.cutoff_at + 1.hour) do
        result = Payroll::ScheduledCutoffFinalizer.new(period_id: scheduled.id).call
        expect(result[:status]).to eq("finalized"), result.inspect
      end
      expect(scheduled.reload.payroll_batch.payroll_batch_entries.where(source_time_entry_id: entry.id)).to be_empty
      expect(batch.reload.attributes).to eq(frozen_manual)
      expect([ origin.reload.attributes, origin_batch.reload.attributes,
        origin_batch.payroll_batch_entries.map(&:attributes), origin.payroll_outbox_events.map(&:attributes) ]).to eq(frozen_origin)
    end
  end
end
