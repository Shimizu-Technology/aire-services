# frozen_string_literal: true

require "rails_helper"

RSpec.describe PayrollOutboxDeliveryJob do
  include ActiveJob::TestHelper

  around do |example|
    previous = ENV["CONNECTED_PAYROLL_MODE"]
    ENV["CONNECTED_PAYROLL_MODE"] = "paused"
    example.run
  ensure
    ENV["CONNECTED_PAYROLL_MODE"] = previous
    clear_enqueued_jobs
  end

  it "rechecks event-specific jobs in one minute without touching reservations or consuming delivery attempts" do
    period = create(:payroll_calendar_period)
    event = period.payroll_outbox_events.create!(event_type: "payroll_batch.finalized",
      occurred_at: Time.current, delivery_enqueued_until: 5.minutes.from_now, payload: { schema_version: "1.0" })
    original = event.attributes
    expect(Net::HTTP).not_to receive(:start)
    expect { described_class.perform_now(event.id) }.to have_enqueued_job(described_class).with(event.id).at(a_value > Time.current)
    expect(event.reload.attributes).to eq(original)
  end

  it "leaves recurring dispatchers to the next scheduled sweep without accumulating paused jobs" do
    expect { described_class.perform_now }.not_to have_enqueued_job(described_class)
  end
end
