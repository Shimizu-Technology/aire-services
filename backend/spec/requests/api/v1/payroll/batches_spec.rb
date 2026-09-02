# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Api::V1::Payroll::Batches", type: :request do
  let(:secret) { "cornerstone-test-secret" }
  let(:admin) { create(:user, :admin) }
  let(:employee) { create(:user, :employee) }
  let(:category) { create(:time_category, hourly_rate_cents: 2_800) }

  around do |example|
    previous = ENV["PAYROLL_SHARED_SECRET"]
    ENV["PAYROLL_SHARED_SECRET"] = secret
    example.run
  ensure
    ENV["PAYROLL_SHARED_SECRET"] = previous
  end

  def json
    JSON.parse(response.body, symbolize_names: true)
  end

  def finalized_batch
    date = Date.new(2026, 8, 15)
    guam = ActiveSupport::TimeZone[TimeClockService::BUSINESS_TIMEZONE]
    create(
      :time_entry,
      user: employee,
      time_category: category,
      work_date: date,
      start_time: guam.local(2026, 8, 15, 8),
      end_time: guam.local(2026, 8, 15, 16),
      hours: 8,
      status: "completed",
      approval_status: nil,
      overtime_status: "none"
    )
    Payroll::BatchFinalizer.new(start_date: "2026-08-01", end_date: "2026-08-15", actor: admin).call
  end

  it "requires the shared secret" do
    get "/api/v1/payroll/batches"
    expect(response).to have_http_status(:unauthorized)

    get "/api/v1/payroll/batches", headers: { "X-Payroll-Shared-Secret" => "wrong" }
    expect(response).to have_http_status(:unauthorized)
  end

  it "discovers finalized batches by exact nominal dates" do
    batch = finalized_batch

    get "/api/v1/payroll/batches",
        params: { start_date: "2026-08-01", end_date: "2026-08-15" },
        headers: { "X-Payroll-Shared-Secret" => secret }

    expect(response).to have_http_status(:ok)
    expect(json.dig(:payroll_batches, 0)).to include(id: batch.public_id, checksum: batch.checksum)
  end

  it "returns the stable payload and audits integration retrieval" do
    batch = finalized_batch

    expect do
      get "/api/v1/payroll/batches/#{batch.public_id}",
          headers: { "X-Shared-Secret" => secret }
    end.to change { AuditLog.where(action: "payroll_batch.retrieved").count }.by(1)

    expect(response).to have_http_status(:ok)
    expect(json.dig(:export)).to include(batch_id: batch.public_id, checksum: batch.checksum, readiness_status: "finalized")
    expect(json.dig(:employees, 0, :adjustments, 0, :source_kind)).to eq("current")

    response_payload = JSON.parse(response.body)
    exported_checksum = response_payload.delete("export").fetch("checksum")
    expect(Payroll::CanonicalPayload.checksum(response_payload)).to eq(exported_checksum)
  end

  it "returns a JSON 404 for an unknown batch" do
    get "/api/v1/payroll/batches/AIRE-PAY-MISSING", headers: { "X-Shared-Secret" => secret }

    expect(response).to have_http_status(:not_found)
    expect(json.fetch(:error)).to eq("Payroll batch not found")
  end

  it "records idempotent Cornerstone processing events without changing the finalized payload" do
    batch = finalized_batch
    original_payload = batch.payload.deep_dup
    event = {
      event_id: "cornerstone-import-42",
      status: "imported",
      occurred_at: Time.current.iso8601,
      external_system: "cornerstone_payroll",
      external_pay_period_id: "42",
      metadata: { company_id: 7 }
    }

    expect do
      post "/api/v1/payroll/batches/#{batch.public_id}/processing_events",
           params: event,
           headers: { "X-Payroll-Shared-Secret" => secret }
    end.to change(PayrollBatchProcessingEvent, :count).by(1)
    expect(response).to have_http_status(:created)
    expect(json.dig(:processing, :status)).to eq("imported")

    expect do
      post "/api/v1/payroll/batches/#{batch.public_id}/processing_events",
           params: event,
           headers: { "X-Payroll-Shared-Secret" => secret }
    end.not_to change(PayrollBatchProcessingEvent, :count)
    expect(response).to have_http_status(:ok)
    expect(batch.reload.payload).to eq(original_payload)
  end

  it "rolls back a processing event when its audit record cannot be written" do
    batch = finalized_batch
    allow(AuditLog).to receive(:record!).and_raise(StandardError, "audit failed")
    event_count = PayrollBatchProcessingEvent.count

    expect do
      post "/api/v1/payroll/batches/#{batch.public_id}/processing_events",
           params: {
             event_id: "cornerstone-atomic-import-42",
             status: "imported",
             occurred_at: Time.current.iso8601,
             external_system: "cornerstone_payroll",
             external_pay_period_id: "42"
           },
           headers: { "X-Payroll-Shared-Secret" => secret }
    end.to raise_error(StandardError, "audit failed")
    expect(PayrollBatchProcessingEvent.count).to eq(event_count)
  end

  it "accepts an idempotent replay when the timestamp uses an equivalent offset" do
    batch = finalized_batch
    event = {
      event_id: "cornerstone-offset-import-42",
      status: "imported",
      occurred_at: "2026-09-02T10:00:00.123456789+10:00",
      external_system: "cornerstone_payroll",
      external_pay_period_id: "42",
      metadata: { company_id: 7 }
    }

    post "/api/v1/payroll/batches/#{batch.public_id}/processing_events",
         params: event,
         headers: { "X-Payroll-Shared-Secret" => secret }
    expect(response).to have_http_status(:created)

    expect do
      post "/api/v1/payroll/batches/#{batch.public_id}/processing_events",
           params: event.merge(occurred_at: "2026-09-02T00:00:00.123456Z"),
           headers: { "X-Payroll-Shared-Secret" => secret }
    end.not_to change(PayrollBatchProcessingEvent, :count)
    expect(response).to have_http_status(:ok)
  end

  it "rejects a non-string processing timestamp as invalid input" do
    batch = finalized_batch

    expect do
      post "/api/v1/payroll/batches/#{batch.public_id}/processing_events",
           params: {
             event_id: "cornerstone-invalid-timestamp-42",
             status: "imported",
             occurred_at: 123,
             external_system: "cornerstone_payroll"
           },
           headers: { "X-Payroll-Shared-Secret" => secret },
           as: :json
    end.not_to change(PayrollBatchProcessingEvent, :count)

    expect(response).to have_http_status(:unprocessable_entity)
    expect(json.fetch(:error)).to be_present
  end

  it "rejects conflicting status or metadata reuse without changing the original event" do
    batch = finalized_batch
    original = {
      event_id: "cornerstone-conflict-42",
      status: "imported",
      occurred_at: "2026-09-02T00:00:00Z",
      external_system: "cornerstone_payroll",
      external_pay_period_id: "42",
      metadata: { company_id: 7 }
    }
    headers = { "X-Payroll-Shared-Secret" => secret }
    post "/api/v1/payroll/batches/#{batch.public_id}/processing_events", params: original, headers: headers
    stored_event = PayrollBatchProcessingEvent.find_by!(event_id: original.fetch(:event_id))
    original_attributes = stored_event.attributes

    [ original.merge(status: "committed"), original.merge(metadata: { company_id: 8 }) ].each do |conflict|
      expect do
        post "/api/v1/payroll/batches/#{batch.public_id}/processing_events", params: conflict, headers: headers
      end.not_to change(PayrollBatchProcessingEvent, :count)
      expect(response).to have_http_status(:conflict)
      expect(json.fetch(:error)).to eq("Event ID already belongs to a different processing event")
      expect(stored_event.reload.attributes).to eq(original_attributes)
    end
  end

  it "does not let a delayed imported event regress a committed batch" do
    batch = finalized_batch
    headers = { "X-Payroll-Shared-Secret" => secret }
    post "/api/v1/payroll/batches/#{batch.public_id}/processing_events",
         params: { event_id: "commit-1", status: "committed", occurred_at: Time.current.iso8601, external_system: "cornerstone_payroll" },
         headers: headers
    post "/api/v1/payroll/batches/#{batch.public_id}/processing_events",
         params: { event_id: "import-1", status: "imported", occurred_at: 1.minute.from_now.iso8601, external_system: "cornerstone_payroll" },
         headers: headers

    expect(response).to have_http_status(:created)
    expect(json.dig(:processing, :status)).to eq("committed")
  end
end
