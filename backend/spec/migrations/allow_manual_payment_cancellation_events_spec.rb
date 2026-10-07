# frozen_string_literal: true

require "rails_helper"
require Rails.root.join("db/migrate/20261007010000_allow_manual_payment_cancellation_events")

RSpec.describe AllowManualPaymentCancellationEvents, type: :model do
  around do |example|
    ActiveRecord::Base.transaction(requires_new: true) do
      example.run
      raise ActiveRecord::Rollback
    end
  ensure
    PayrollManualAllocation.reset_column_information
    PayrollManualAllocationEvent.reset_column_information
  end

  def cancellation_constraints
    ActiveRecord::Base.connection.select_all(<<~SQL).to_a
      SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conname IN ('check_payroll_manual_allocation_events_type', 'check_payroll_settlement_case_events_type')
      ORDER BY conname
    SQL
  end

  def expect_history_preserved(event)
    before = event.attributes
    constraints = cancellation_constraints
    expect { described_class.new.down }.to raise_error(ActiveRecord::IrreversibleMigration, /append-only/)
    expect(cancellation_constraints).to eq(constraints)
    expect(event.reload.attributes).to eq(before)
    expect(ActiveRecord::Base.connection.column_exists?(:payroll_manual_allocations, :payment_cancelled_at)).to be(true)
    expect(ActiveRecord::Base.connection.column_exists?(:payroll_manual_allocation_events, :cancellation_evidence_reference)).to be(true)
  end

  it "refuses rollback before changing constraints or immutable manual cancellation evidence" do
    actor = create(:user, :admin)
    employee = create(:user, :employee)
    entry = create(:time_entry, user: employee)
    allocation = PayrollManualAllocation.create!(time_entry: entry, user: employee, recorded_by: actor,
      source_user_uuid: employee.payroll_integration_uuid, source_time_entry_version: entry.lock_version,
      work_date: entry.work_date, pay_date: Date.current, regular_hours: 8, overtime_hours: 0,
      external_pay_period_id: "synthetic-rollback-period", external_payroll_item_id: "synthetic-rollback-item",
      reason: "Synthetic retained payroll source claim")
    event = allocation.payroll_manual_allocation_events.create!(actor: actor, event_type: "payment_cancelled",
      occurred_at: Time.current, payment_method: "paper_check", payment_reference: "SYNTHETIC-ROLLBACK-1",
      cancellation_evidence_reference: "SYNTHETIC-STOP-1", reason: "Synthetic verified physical payment cancellation")

    expect_history_preserved(event)
  end

  it "refuses rollback before changing constraints or immutable settlement cancellation evidence" do
    settlement = create(:payroll_settlement_case)
    event = settlement.payroll_settlement_case_events.create!(event_id: SecureRandom.uuid,
      event_type: "payment_cancelled", occurred_at: Time.current, from_status: "settled", to_status: "in_payroll",
      metadata: { cancellation_evidence_reference: "SYNTHETIC-STOP-2" })

    expect_history_preserved(event)
  end

  it "retains the original reversible downgrade when no cancellation history exists" do
    migration = described_class.new
    migration.down
    expect(ActiveRecord::Base.connection.column_exists?(:payroll_manual_allocations, :payment_cancelled_at)).to be(false)
    expect(ActiveRecord::Base.connection.column_exists?(:payroll_manual_allocation_events, :cancellation_evidence_reference)).to be(false)
    expect(cancellation_constraints).to all(satisfy { |constraint| !constraint.fetch("definition").include?("payment_cancelled") })

    migration.up
    expect(ActiveRecord::Base.connection.column_exists?(:payroll_manual_allocations, :payment_cancelled_at)).to be(true)
    expect(cancellation_constraints).to all(satisfy { |constraint| constraint.fetch("definition").include?("payment_cancelled") })
  end
end
