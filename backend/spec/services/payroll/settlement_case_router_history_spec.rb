# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::SettlementCaseRouter do
  include ActiveSupport::Testing::TimeHelpers

  around { |example| travel_to(Time.utc(2026, 10, 1)) { example.run } }

  let(:actor) { create(:user, :admin, first_name: "Review", last_name: "Manager") }
  let(:worker) { create(:user, :employee, first_name: "Held", last_name: "Worker") }
  let(:invalid_entry) do
    create(:time_entry, user: worker, work_date: Date.new(2026, 9, 1), approval_status: "pending",
           end_time: ActiveSupport::TimeZone["Pacific/Guam"].local(2000, 1, 1, 10))
  end
  let(:held_case) do
    create(:payroll_settlement_case, source_time_entry_id: invalid_entry.id,
           source_user_id: worker.id, source_user_uuid: worker.payroll_integration_uuid,
           held_total_hours: 1, source_snapshot: { "employee_name" => worker.full_name })
  end
  let(:reason) { "Duplicate input; no work occurred. Preserve the separate valid pending time." }
  let(:payload) { { command_id: SecureRandom.uuid, expected_version: held_case.lock_version, destination_kind: "not_payable", reason: reason } }

  def command(parameters = payload)
    Payroll::CockpitCommand.new(command_id: parameters.fetch(:command_id), action: "payroll_settlement_case.route",
      actor: actor, target: held_case, expected_version: parameters.fetch(:expected_version), payload: parameters).call do |locked|
      updated = described_class.new(settlement_case: locked, destination_kind: parameters.fetch(:destination_kind),
        target_external_pay_period_id: parameters[:target_external_pay_period_id], action_due_on: parameters[:action_due_on],
        assigned_to_id: nil, reason: parameters.fetch(:reason), actor: actor).call
      [ {}, :ok, { result_version: updated.lock_version } ]
    end
  end

  it "records a matching decision audit once and leaves unrelated active time and payment evidence unchanged" do
    valid_entry = create(:time_entry, user: worker, work_date: Date.new(2026, 9, 2),
                         approval_status: "pending", end_time: ActiveSupport::TimeZone["Pacific/Guam"].local(2000, 1, 1, 13))
    valid = create(:payroll_settlement_case, origin_payroll_batch: held_case.origin_payroll_batch,
                   source_time_entry_id: valid_entry.id, source_user_id: worker.id, held_total_hours: 4)
    before = [ valid.attributes, valid.origin_payroll_batch.attributes, valid_entry.reload.attributes, invalid_entry.reload.attributes ]
    saved_payload = payload
    expect { command(saved_payload) }.to change { AuditLog.where(action: "payroll_settlement_case.marked_not_payable").count }.by(1)
    decision = held_case.payroll_settlement_case_events.find_by!(event_type: "marked_not_payable")
    audit = AuditLog.find_by!(action: "payroll_settlement_case.marked_not_payable")
    expect(audit).to have_attributes(user: actor, actor_name: actor.full_name, event_category: "payroll", source: "integration",
                                    auditable_type: "PayrollSettlementCase", auditable_id: held_case.id, occurred_at: decision.occurred_at)
    expect(audit.metadata).to include("settlement_case_id" => held_case.public_id, "source_time_entry_id" => held_case.source_time_entry_id.to_s,
      "source_user_uuid" => worker.payroll_integration_uuid, "employee_name" => worker.full_name,
      "event_id" => decision.event_id, "event_type" => "marked_not_payable", "reason" => reason, "destination_kind" => "not_payable")
    expect(command(saved_payload).replayed).to be(true)
    expect(AuditLog.where(action: audit.action).count).to eq(1)
    expect(held_case.payroll_settlement_case_events.count).to eq(1)
    expect([ valid.reload.attributes, valid.origin_payroll_batch.reload.attributes,
            valid_entry.reload.attributes, invalid_entry.reload.attributes ]).to eq(before)
    expect(PayrollManualAllocation.count).to eq(0)
    expect(PayrollEntryProcessingEvent.count).to eq(0)
  end

  it "rolls the case decision, event and command receipt back if its audit cannot be saved" do
    before = held_case.attributes
    allow(AuditLog).to receive(:record!).and_raise(ActiveRecord::RecordInvalid.new(AuditLog.new))
    expect { command }.to raise_error(ActiveRecord::RecordInvalid)
    expect(held_case.reload.attributes).to eq(before)
    expect(held_case.payroll_settlement_case_events.count).to eq(0)
    expect(PayrollIntegrationCommand.count).to eq(0)
  end

  it "retains route and reroute decision types in Activity History" do
    future = create(:payroll_calendar_period, start_date: Date.new(2026, 11, 1), end_date: Date.new(2026, 11, 15))
    first = payload.merge(destination_kind: "regular", target_external_pay_period_id: future.external_pay_period_id)
    command(first)
    second = payload.merge(command_id: SecureRandom.uuid, expected_version: held_case.reload.lock_version,
                           destination_kind: "supplemental", target_external_pay_period_id: "reviewed-supplemental", action_due_on: "2026-11-20")
    command(second)
    expect(AuditLog.where(auditable_type: "PayrollSettlementCase", auditable_id: held_case.id).order(:id).pluck(:action))
      .to eq(%w[payroll_settlement_case.routed payroll_settlement_case.rerouted])
  end
end
