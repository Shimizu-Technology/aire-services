# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::CockpitPeriodSnapshot do
  let(:period) { create(:payroll_calendar_period) }
  let(:employee) { create(:user, :employee) }
  let(:category) { create(:time_category) }

  def entry_for(date)
    create(
      :time_entry,
      user: employee,
      time_category: category,
      work_date: date,
      entry_method: "clock",
      status: "completed",
      approval_status: nil
    )
  end

  it "reuses one complete preview while returning only the requested page state" do
    first = entry_for(period.start_date)
    second = entry_for(period.start_date + 1.day)
    cache = ActiveSupport::Cache::MemoryStore.new
    allow(Rails).to receive(:cache).and_return(cache)
    expect(Payroll::BatchBuilder).to receive(:new).once.and_call_original

    first_page = described_class.new(period: period, entries: [ first ]).call
    second_page = described_class.new(period: period, entries: [ second ]).call

    expect(first_page.entry_states.keys).to eq([ first.id ])
    expect(second_page.entry_states.keys).to eq([ second.id ])
    expect(first_page.entry_states.dig(first.id, :payable_now)).to be(true)
    expect(second_page.entry_states.dig(second.id, :payable_now)).to be(true)
  end

  it "separates pending payment attestations from eligible and held hours" do
    entry = create(:time_entry, user: employee, time_category: category,
                                work_date: period.start_date, hours: 8,
                                status: "completed", entry_method: "manual",
                                approval_status: "approved", approved_at: Time.current)
    Payroll::PaymentAttestationRecorder.new(actor: create(:user, :admin)).attest!(
      entry: entry, source_user_uuid: employee.payroll_integration_uuid,
      reason: "Owner confirmed the work was paid; original check evidence is still pending."
    )

    snapshot = described_class.new(period: period, entries: [ entry ]).call

    expect(snapshot.readiness).to include(
      total_entries: 1, total_hours: 8.0,
      eligible_entries: 0, eligible_hours: 0.0,
      held_entries: 0, held_hours: 0.0,
      payment_attested_pending_evidence_entries: 1,
      payment_attested_pending_evidence_hours: 8.0
    )
    expect(snapshot.entry_states.dig(entry.id, :payable_now)).to be(false)
    expect(snapshot.entry_states.dig(entry.id, :payroll_disposition)).to eq("payment_attested_pending_evidence")
  end
end
