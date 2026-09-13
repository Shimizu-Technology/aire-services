# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Payroll cutoff jobs" do
  it "runs the due cutoff sweep" do
    allow(Payroll::ScheduledCutoffFinalizer).to receive(:call_due)

    PayrollCutoffFinalizationJob.perform_now

    expect(Payroll::ScheduledCutoffFinalizer).to have_received(:call_due)
  end

  it "runs the due outbox sweep" do
    allow(Payroll::OutboxDispatcher).to receive(:call_due)

    PayrollOutboxDeliveryJob.perform_now

    expect(Payroll::OutboxDispatcher).to have_received(:call_due)
  end

  it "delivers one claimed outbox event per job" do
    dispatcher = instance_double(Payroll::OutboxDispatcher, call: { status: "delivered" })
    allow(Payroll::OutboxDispatcher).to receive(:new).with(event_id: 42).and_return(dispatcher)

    PayrollOutboxDeliveryJob.perform_now(42)

    expect(dispatcher).to have_received(:call)
  end
end
