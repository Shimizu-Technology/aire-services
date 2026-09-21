# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::PaymentAttestationRecorder do
  let(:actor) { create(:user, :admin) }
  let(:employee) { create(:user, :employee) }
  let(:entry) do
    create(:time_entry, user: employee, time_category: create(:time_category),
                        work_date: Date.new(2026, 5, 11), hours: 8,
                        status: "completed", entry_method: "manual",
                        approval_status: "approved", approved_at: Time.zone.parse("2026-05-27 10:00"))
  end
  let(:recorder) { described_class.new(actor: actor) }
  let(:statement) { "Leon confirmed this maintenance work was paid; Chelsea will identify the original check." }

  def attest
    recorder.attest!(entry: entry, source_user_uuid: employee.payroll_integration_uuid, reason: statement)
  end

  def preview
    Payroll::BatchBuilder.new(start_date: "2026-05-01", end_date: "2026-05-15",
                              cutoff_at: Time.zone.parse("2026-09-21 17:00")).call
  end

  it "holds exact source hours without recording them as verified paid or inventing a check" do
    attestation = attest

    expect(attestation).to have_attributes(status: "pending_evidence", hours: 8)
    expect(attestation.payroll_payment_attestation_events.pluck(:event_type)).to eq([ "attested" ])
    expect(preview.dig(:summary, :total_hours)).to eq(0.0)
    expect(preview.dig(:issues, :payment_attestation_pending_count)).to eq(1)
    expect(PayrollManualAllocation.where(time_entry_id: entry.id)).to be_empty
    expect do
      Payroll::ManualAllocationRecorder.new(actor: actor).commit!(
        entry: entry, source_user_uuid: employee.payroll_integration_uuid,
        regular_hours: "8.00", overtime_hours: "0.00",
        external_pay_period_id: "28", external_payroll_item_id: "999",
        pay_date: "2026-05-30", reason: "Attempted link without matching payment evidence"
      )
    end.to raise_error(Payroll::ManualAllocationRecorder::Error, /held by an owner payment attestation/)

    lifecycle = Payroll::EntryLifecycleResolver.new(entries: [ entry ]).call.fetch(entry.id)
    expect(lifecycle.fetch(:status)).to eq("payment_attested_pending_evidence")
    expect(lifecycle.fetch(:label)).to eq("Paid — owner attested; check details pending")
    expect(lifecycle.fetch(:payment_attested_hours)).to eq(8.0)
    expect(lifecycle.fetch(:manually_paid_hours)).to eq(0.0)
    expect(lifecycle[:payment_reference]).to be_nil
    expect(lifecycle[:payment_effective_on]).to be_nil
  end

  it "prevents duplicate, wrong-identity, and already-batched attestations" do
    expect do
      recorder.attest!(entry: entry, source_user_uuid: SecureRandom.uuid, reason: statement)
    end.to raise_error(described_class::Error, /identity changed/)

    attest
    expect { attest }.to raise_error(described_class::Error, /already has a payment attestation/)

    other_entry = create(:time_entry, user: employee, time_category: create(:time_category),
                                      work_date: Date.new(2026, 5, 12), hours: 8,
                                      status: "completed", entry_method: "manual", approval_status: "approved")
    batch = create(:payroll_batch)
    batch.payroll_batch_entries.create!(
      source_time_entry_id: other_entry.id, source_user_id: employee.id,
      source_user_uuid: employee.payroll_integration_uuid,
      source_category_id: other_entry.time_category_id, work_date: other_entry.work_date,
      week_start: other_entry.work_date.beginning_of_week(:sunday),
      total_hours: 8, regular_hours: 8, overtime_hours: 0,
      source_kind: "current", line_key: "category:#{other_entry.time_category_id}", snapshot: {}
    )
    expect do
      recorder.attest!(entry: other_entry, source_user_uuid: employee.payroll_integration_uuid, reason: statement)
    end.to raise_error(described_class::Error, /already represented/)
  end

  it "keeps edited source hours held and visibly flags that they changed" do
    attest
    entry.update!(description: "Updated maintenance note")
    lifecycle = Payroll::EntryLifecycleResolver.new(entries: [ entry.reload ]).call.fetch(entry.id)

    expect(lifecycle.fetch(:payment_attestation_source_changed)).to be(true)
    expect(preview.dig(:summary, :total_hours)).to eq(0.0)
  end

  it "permits a reasoned retraction even after the held time entry changes" do
    attestation = attest
    entry.update!(description: "Corrected historical maintenance note")

    expect(attestation.reload.source_changed?).to be(true)
    recorder.retract!(attestation: attestation, reason: "The historical source entry changed; this hold must be reviewed and withdrawn before any new attribution.")
    expect(attestation.reload.status).to eq("retracted")
  end

  it "returns the source entry to the payable preview only after a reasoned retraction" do
    attestation = attest
    recorder.retract!(attestation: attestation, reason: "Chelsea verified this owner statement was mistaken and the work remains unpaid.")

    expect(attestation.reload.status).to eq("retracted")
    expect(attestation.payroll_payment_attestation_events.pluck(:event_type)).to eq(%w[attested retracted])
    expect(preview.dig(:summary, :total_hours)).to eq(8.0)
  end
end
