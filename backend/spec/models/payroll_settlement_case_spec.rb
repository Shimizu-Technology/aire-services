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
end
