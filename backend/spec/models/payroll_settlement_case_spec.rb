# frozen_string_literal: true

require "rails_helper"

RSpec.describe PayrollSettlementCase do
  it "requires a named period for regular routing and a named run for supplemental routing" do
    settlement_case = build(:payroll_settlement_case, destination_kind: "regular", status: "scheduled")
    expect(settlement_case).not_to be_valid
    expect(settlement_case.errors.full_messages).to include("regular destinations require a named AIRE payroll period")

    settlement_case.destination_kind = "supplemental"
    expect(settlement_case).not_to be_valid
    expect(settlement_case.errors[:target_external_pay_period_id]).to include("is required for a supplemental payroll")
  end

  it "keeps the event timeline append-only in PostgreSQL" do
    settlement_case = create(:payroll_settlement_case)
    event = settlement_case.payroll_settlement_case_events.create!(
      event_id: SecureRandom.uuid,
      event_type: "opened",
      to_status: "open",
      occurred_at: Time.current
    )

    expect do
      PayrollSettlementCaseEvent.transaction(requires_new: true) do
        PayrollSettlementCaseEvent.where(id: event.id).update_all(to_status: "scheduled")
      end
    end.to raise_error(ActiveRecord::StatementInvalid, /append-only/)
    expect do
      PayrollSettlementCaseEvent.transaction(requires_new: true) do
        PayrollSettlementCaseEvent.where(id: event.id).delete_all
      end
    end.to raise_error(ActiveRecord::StatementInvalid, /append-only/)
  end

  it "requires closed cases to carry a resolution timestamp" do
    settlement_case = build(
      :payroll_settlement_case,
      destination_kind: "not_payable",
      status: "not_payable",
      resolved_at: nil
    )

    expect(settlement_case).not_to be_valid
    expect(settlement_case.errors[:resolved_at]).to include("is required for a closed case")
  end

  it "allows an unassigned case to close as superseded" do
    settlement_case = build(
      :payroll_settlement_case,
      destination_kind: "unassigned",
      status: "superseded",
      resolved_at: Time.current
    )

    expect(settlement_case).to be_valid
  end

  it "enforces one active case per origin batch and source entry in PostgreSQL" do
    origin_batch = create(:payroll_batch)
    existing = create(
      :payroll_settlement_case,
      origin_payroll_batch: origin_batch,
      source_time_entry_id: 91,
      source_time_entry_version: 1,
      origin_reason: "pending_approval"
    )

    expect do
      PayrollSettlementCase.insert_all!([ {
        public_id: SecureRandom.uuid,
        origin_payroll_batch_id: origin_batch.id,
        source_time_entry_id: existing.source_time_entry_id,
        source_time_entry_version: 2,
        source_user_id: existing.source_user_id,
        source_user_uuid: existing.source_user_uuid,
        origin_reason: "changed_after_cutoff",
        original_work_date: existing.original_work_date,
        held_total_hours: 1,
        destination_kind: "unassigned",
        owner_role: "aire_admins",
        action_due_on: existing.action_due_on,
        status: "open",
        source_snapshot: {},
        created_at: Time.current,
        updated_at: Time.current
      } ])
    end.to raise_error(ActiveRecord::RecordNotUnique, /active_origin_entry/)
  end
end
