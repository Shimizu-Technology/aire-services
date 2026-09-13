# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::OutboxDispatcher do
  include ActiveSupport::Testing::TimeHelpers

  let(:guam) { ActiveSupport::TimeZone["Pacific/Guam"] }
  let(:now) { guam.local(2026, 10, 18, 17, 5) }
  let(:period) { create(:payroll_calendar_period) }
  let(:event) do
    period.payroll_outbox_events.create!(
      event_type: "payroll_batch.finalized",
      occurred_at: now - 5.minutes,
      next_delivery_attempt_at: now,
      payload: { schema_version: "1.0", event_type: "payroll_batch.finalized" }
    )
  end
  let(:environment) do
    {
      "CORNERSTONE_PAYROLL_EVENTS_URL" => "https://payroll.example.com/api/v1/integrations/aire/events",
      "PAYROLL_SHARED_SECRET" => "shared-secret"
    }
  end

  it "delivers the immutable event with authentication and an idempotency key" do
    captured = nil
    client = lambda do |uri, payload, headers|
      captured = { uri: uri, payload: payload, headers: headers }
      Struct.new(:code).new("202")
    end

    result = described_class.new(event_id: event.id, now: now, env: environment, client: client).call

    expect(result).to include(status: "delivered", response_status: 202)
    expect(event.reload.delivery_status).to eq("delivered")
    expect(captured[:uri].to_s).to eq(environment.fetch("CORNERSTONE_PAYROLL_EVENTS_URL"))
    expect(captured[:headers]).to include(
      "X-Shared-Secret" => "shared-secret",
      "Idempotency-Key" => event.event_id
    )
    expect(captured[:payload]).to eq(event.payload)
    expect(AuditLog.find_by!(action: "payroll_outbox_event.delivered", auditable: event).source).to eq("system")
  end

  it "queues each due event as an individual delivery job" do
    queued_ids = []
    event

    result = described_class.call_due(now: now, enqueue: ->(event_id) { queued_ids << event_id })

    expect(queued_ids).to eq([ event.id ])
    expect(result).to eq([ { event_id: event.id, status: "queued" } ])
    expect(event.reload.delivery_attempts).to eq(0)
  end

  it "leaves the event durable and schedules a retry when Cornerstone is unavailable" do
    client = ->(*) { Struct.new(:code).new("503") }

    result = described_class.new(event_id: event.id, now: now, env: environment, client: client).call

    expect(result).to include(status: "failed", error: "Cornerstone returned HTTP 503")
    expect(event.reload).to have_attributes(
      delivery_status: "failed",
      delivery_attempts: 1,
      last_response_status: 503,
      next_delivery_attempt_at: now + 1.minute
    )
  end

  it "keeps the event retryable when the network connection fails" do
    client = ->(*) { raise Net::OpenTimeout, "execution expired" }

    result = described_class.new(event_id: event.id, now: now, env: environment, client: client).call

    expect(result).to include(status: "failed", error: "execution expired")
    expect(event.reload).to have_attributes(
      delivery_status: "failed",
      delivery_attempts: 1,
      next_delivery_attempt_at: now + 1.minute
    )
    expect(event.last_error).to include("Net::OpenTimeout")
  end

  it "reports repeated delivery failures to production error monitoring" do
    event.update!(delivery_attempts: 4)
    allow(Rails.error).to receive(:report)

    described_class.new(
      event_id: event.id,
      now: now,
      env: environment,
      client: ->(*) { Struct.new(:code).new("503") }
    ).call

    expect(Rails.error).to have_received(:report).with(
      instance_of(Payroll::RetrySchedule::RepeatedFailure),
      handled: true,
      severity: :warning,
      context: hash_including(record_type: "PayrollOutboxEvent", record_id: event.event_id, attempts: 5)
    )
  end

  it "fails safely when delivery is not configured and does not retry early" do
    first = described_class.new(event_id: event.id, now: now, env: {}).call
    early = described_class.new(event_id: event.id, now: now + 30.seconds, env: {}).call

    expect(first[:status]).to eq("failed")
    expect(early[:status]).to eq("skipped")
    expect(event.reload.delivery_attempts).to eq(1)
  end

  it "enforces immutable payloads in PostgreSQL while allowing delivery metadata" do
    event.update!(delivery_status: "failed", delivery_attempts: 1)
    expect(event.reload.delivery_status).to eq("failed")

    expect do
      PayrollOutboxEvent.transaction(requires_new: true) do
        ActiveRecord::Base.connection.execute(
          "UPDATE payroll_outbox_events SET payload = '{\"changed\":true}' WHERE id = #{event.id}"
        )
      end
    end.to raise_error(ActiveRecord::StatementInvalid, /immutable/)
  end
end
