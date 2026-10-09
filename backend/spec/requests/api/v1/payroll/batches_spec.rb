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

  def finalized_batch(hours: 8)
    date = Date.new(2026, 8, 15)
    guam = ActiveSupport::TimeZone[TimeClockService::BUSINESS_TIMEZONE]
    create(
      :time_entry,
      user: employee,
      time_category: category,
      work_date: date,
      start_time: guam.local(2026, 8, 15, 8),
      end_time: guam.local(2026, 8, 15, 8) + hours.hours,
      hours: hours,
      status: "completed",
      entry_method: "clock",
      clock_source: "legacy",
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
    expect(json.dig(:export, :integration)).to include(
      protocol: "shimizu_time_payroll",
      protocol_version: "1.0",
      source_type: "aire_services"
    )
    expect(json.dig(:export, :integration, :source_instance_id)).to match(Payroll::IntegrationProfile::UUID_PATTERN)
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

  it "records idempotent entry lifecycle events against the immutable staff identity" do
    batch = finalized_batch
    batch_entry = batch.payroll_batch_entries.first
    headers = { "X-Payroll-Shared-Secret" => secret }
    event = {
      event_id: "cornerstone-entry-paid-42",
      status: "payment_issued",
      occurred_at: "2026-09-04T10:00:00.123456+10:00",
      external_system: "cornerstone_payroll",
      external_pay_period_id: "42",
      external_payroll_item_id: "99",
      source_time_entry_id: batch_entry.source_time_entry_id,
      source_user_uuid: batch_entry.source_user_uuid,
      contract_version: "2.0",
      source_line_key: batch_entry.line_key,
      source_kind: batch_entry.source_kind,
      total_hours: batch_entry.total_hours.to_s,
      regular_hours: batch_entry.regular_hours.to_s,
      overtime_hours: batch_entry.overtime_hours.to_s,
      payment_method: "paper_check",
      payment_reference: "5001"
    }

    expect do
      post "/api/v1/payroll/batches/#{batch.public_id}/processing_events", params: event, headers: headers
    end.to change(PayrollEntryProcessingEvent, :count).by(1)
      .and change { AuditLog.where(action: "payroll_entry.processing_status_recorded").count }.by(1)
    expect(response).to have_http_status(:created)
    expect(json.fetch(:entry_processing)).to include(
      status: "payment_issued",
      source_time_entry_id: batch_entry.source_time_entry_id.to_s,
      source_user_uuid: employee.payroll_integration_uuid,
      contract_version: "2.0",
      source_line_key: batch_entry.line_key,
      total_hours: batch_entry.total_hours.to_s,
      payment_reference: "5001"
    )
    expect(json.dig(:entry_processing, :occurred_at)).to eq("2026-09-04T00:00:00.123456Z")
    descriptor = json.fetch(:integration)
    expect(descriptor).to eq(Payroll::IntegrationProfile.call)
    acknowledgement = json.fetch(:entry_processing)

    expect do
      post "/api/v1/payroll/batches/#{batch.public_id}/processing_events", params: event, headers: headers
    end.not_to change(PayrollEntryProcessingEvent, :count)
    expect(response).to have_http_status(:ok)
    expect(json.fetch(:entry_processing)).to eq(acknowledgement)
    expect(json.fetch(:integration)).to eq(descriptor)

    original_attributes = PayrollEntryProcessingEvent.find_by!(event_id: event.fetch(:event_id)).attributes
    expect do
      post "/api/v1/payroll/batches/#{batch.public_id}/processing_events",
           params: event.merge(payment_reference: "different-check"),
           headers: headers
    end.not_to change(PayrollEntryProcessingEvent, :count)
    expect(response).to have_http_status(:conflict)
    expect(PayrollEntryProcessingEvent.find_by!(event_id: event.fetch(:event_id)).attributes).to eq(original_attributes)

    expect do
      post "/api/v1/payroll/batches/#{batch.public_id}/processing_events",
           params: event.merge(event_id: "cornerstone-entry-without-identity").except(:source_user_uuid),
           headers: headers
    end.to change(PayrollEntryProcessingEvent, :count).by(1)
    expect(response).to have_http_status(:created)
    expect(json.dig(:entry_processing, :source_user_uuid)).to be_nil

    post "/api/v1/payroll/batches/#{batch.public_id}/processing_events",
         params: event.merge(event_id: "cornerstone-entry-wrong-person", source_user_uuid: SecureRandom.uuid),
         headers: headers
    expect(response).to have_http_status(:conflict)
    expect(json.fetch(:error)).to match(/identity/i)

    post "/api/v1/payroll/batches/#{batch.public_id}/processing_events",
         params: event.merge(event_id: "cornerstone-entry-wrong-hours", total_hours: "7.00", regular_hours: "7.00"),
         headers: headers
    expect(response).to have_http_status(:conflict)
    expect(json.fetch(:error)).to match(/finalized AIRE batch/i)

    legacy_event = event.except(
      :contract_version,
      :source_line_key,
      :source_kind,
      :total_hours,
      :regular_hours,
      :overtime_hours
    ).merge(event_id: "cornerstone-entry-legacy-42")
    expect do
      post "/api/v1/payroll/batches/#{batch.public_id}/processing_events", params: legacy_event, headers: headers
    end.to change(PayrollEntryProcessingEvent, :count).by(1)
    expect(response).to have_http_status(:created)
    expect(json.dig(:entry_processing, :contract_version)).to be_nil
    expect(json.dig(:entry_processing, :occurred_at)).to eq("2026-09-04T00:00:00Z")
    expect(json).not_to have_key(:integration)
  end

  it "acknowledges the exact signed accounting correction and replays without changing paid or frozen history" do
    original = finalized_batch(hours: 4)
    paid = instrument_receipt(original, reference: "ORIGINAL-PAID-1")
    post_receipt(original, paid)
    expect(response).to have_http_status(:created)
    original_event = PayrollEntryProcessingEvent.find_by!(event_id: paid.fetch(:event_id))
    original_evidence = original_event.attributes.deep_dup
    original_frozen = original.attributes.deep_dup
    entry = employee.time_entries.sole
    entry.update!(end_time: entry.end_time - 1.hour)
    correction_batch = Payroll::BatchFinalizer.new(start_date: "2026-08-16", end_date: "2026-08-31", actor: admin,
      acknowledge_negative_adjustments: true, negative_adjustment_note: "Correct the overstated original clock-out").call
    row = correction_batch.payroll_batch_entries.sole
    expect(row).to have_attributes(source_kind: "correction", total_hours: -1, regular_hours: -1, overtime_hours: 0)
    frozen = correction_batch.attributes.deep_dup
    row_evidence = row.attributes.deep_dup
    metadata = { accounting_only: true, correction_disposition_id: "9", original_pay_period_id: "42",
      original_payroll_item_id: "99", corrective_pay_period_id: "44", corrective_payroll_item_id: "55" }
    event = instrument_receipt(correction_batch, status: "committed", occurred_at: "2026-10-01T07:00:00.123456Z")
      .except(:payment_method, :payment_reference).merge(external_pay_period_id: "44", external_payroll_item_id: "55", metadata: metadata)

    expect { post_receipt(correction_batch, event) }.to change(PayrollEntryProcessingEvent, :count).by(1)
      .and change { AuditLog.where(action: "payroll_entry.processing_status_recorded").count }.by(1)
    expect(response).to have_http_status(:created)
    acknowledgement = json.fetch(:entry_processing)
    descriptor = json.fetch(:integration)
    expect(descriptor).to eq(Payroll::IntegrationProfile.call)
    expect(descriptor[:source_instance_id]).to match(Payroll::IntegrationProfile::UUID_PATTERN)
    expect(descriptor[:capabilities]).to include("exact_line_receipts_v2")
    expect(acknowledgement).to include(event.except(:source_time_entry_id).merge(source_time_entry_id: entry.id.to_s))
    expect(acknowledgement.keys.grep(/payment/)).to eq([ :payment_effective_on ])
    expect(acknowledgement[:payment_effective_on]).to be_nil
    saved = PayrollEntryProcessingEvent.find_by!(event_id: event.fetch(:event_id))
    saved_evidence = saved.attributes.deep_dup
    expect(Payroll::AccountingCorrectionReceipt.context(row: row, event: saved)).to eq(metadata.stringify_keys)

    expect { post_receipt(correction_batch, event.merge(occurred_at: "2026-10-01T17:00:00.123456+10:00")) }
      .not_to change { [ PayrollEntryProcessingEvent.count, AuditLog.where(action: "payroll_entry.processing_status_recorded").count ] }
    expect(response).to have_http_status(:ok)
    expect(json).to eq(entry_processing: acknowledgement, integration: descriptor)
    expect { post_receipt(correction_batch, event.merge(occurred_at: "2026-10-01T07:00:00.123455Z")) }
      .not_to change(PayrollEntryProcessingEvent, :count)
    expect(response).to have_http_status(:conflict)
    expect(saved.reload.attributes).to eq(saved_evidence)
    expect(original_event.reload.attributes).to eq(original_evidence)
    expect(original.reload.attributes).to eq(original_frozen)
    expect(correction_batch.reload.attributes).to eq(frozen)
    expect(row.reload.attributes).to eq(row_evidence)
  end
  def instrument_receipt(batch, status: "payment_issued", reference: "ORIGINAL-1", occurred_at: "2026-09-04T10:00:00+10:00")
    row = batch.payroll_batch_entries.first
    { event_id: SecureRandom.uuid, status: status, occurred_at: occurred_at, external_system: "cornerstone_payroll",
      external_pay_period_id: "42", external_payroll_item_id: "99", source_time_entry_id: row.source_time_entry_id,
      source_user_uuid: row.source_user_uuid, contract_version: "2.0", source_line_key: row.line_key,
      source_kind: row.source_kind, total_hours: row.total_hours.to_s, regular_hours: row.regular_hours.to_s,
      overtime_hours: row.overtime_hours.to_s, payment_method: "paper_check", payment_reference: reference,
      metadata: { payment_effective_on: "2026-09-04" } }
  end

  def post_receipt(batch, event)
    post "/api/v1/payroll/batches/#{batch.public_id}/processing_events", params: event.merge(source_time_entry_id: event.fetch(:source_time_entry_id).to_s),
      headers: { "X-Payroll-Shared-Secret" => secret }, as: :json
  end

  it "cancels only the current exact instrument, retains committed coverage, and issues a fresh replacement once" do
    batch = finalized_batch
    issued = instrument_receipt(batch)
    post_receipt(batch, issued)
    expect(response).to have_http_status(:created)
    original = PayrollEntryProcessingEvent.find_by!(event_id: issued[:event_id]).attributes
    cancelled = issued.merge(event_id: SecureRandom.uuid, status: "payment_cancelled", metadata: issued[:metadata].merge(
      cancelled_payment_event_id: issued[:event_id], cancellation_evidence_reference: "BANK-STOP-1"))
    post_receipt(batch, cancelled)
    expect(response).to have_http_status(:created)
    cancellation_ack = json.fetch(:entry_processing)
    expect(cancellation_ack).to include(event_id: cancelled[:event_id], status: "payment_cancelled",
      source_time_entry_id: cancelled[:source_time_entry_id].to_s, source_user_uuid: cancelled[:source_user_uuid],
      contract_version: "2.0", source_line_key: cancelled[:source_line_key], source_kind: cancelled[:source_kind],
      external_system: cancelled[:external_system], external_pay_period_id: "42", external_payroll_item_id: "99",
      payment_method: "paper_check", payment_reference: "ORIGINAL-1", payment_effective_on: "2026-09-04",
      occurred_at: Time.iso8601(cancelled[:occurred_at]).utc.iso8601(6))
    %i[regular_hours overtime_hours total_hours].each do |field|
      expect(BigDecimal(cancellation_ack.fetch(field))).to eq(BigDecimal(cancelled.fetch(field)))
    end
    expect(cancellation_ack.fetch(:metadata)).to include(cancelled_payment_event_id: issued[:event_id],
      cancellation_evidence_reference: "BANK-STOP-1", original_payment_effective_on_known: true,
      original_payment_effective_on: "2026-09-04")
    expect(json.dig(:integration, :capabilities)).to include("payment_cancellation_v1")
    expect(json.dig(:integration, :source_instance_id)).to eq(Payroll::IntegrationProfile.source_instance_id)
    expect(PayrollEntryProcessingEvent.find_by!(event_id: issued[:event_id]).attributes).to eq(original)
    totals = Payroll::EmployeePeriodEvidence.new(user: employee).call[:totals]
    expect(totals).to include(issued_hours: 0.0, committed_hours: 8.0, needs_reconciliation_hours: 0.0)
    expect(Payroll::EntryLifecycleResolver.new(entries: employee.time_entries.to_a).call.values.first[:status]).to eq("payment_cancelled")
    expect { post_receipt(batch, issued) }.not_to change(PayrollEntryProcessingEvent, :count)
    expect(response).to have_http_status(:ok)
    expect(Payroll::EmployeePeriodEvidence.new(user: employee).call[:totals][:issued_hours]).to eq(0.0)
    replacement = instrument_receipt(batch, reference: "REPLACEMENT-2")
    [ replacement.merge(payment_method: nil), replacement.merge(payment_reference: nil) ].each do |incomplete|
      expect { post_receipt(batch, incomplete) }.not_to change(PayrollEntryProcessingEvent, :count)
      expect(response).to have_http_status(:conflict)
    end
    post_receipt(batch, replacement)
    expect(response).to have_http_status(:created)
    expect(Payroll::EmployeePeriodEvidence.new(user: employee).call[:totals]).to include(issued_hours: 8.0, committed_hours: 0.0)
    expect { post_receipt(batch, cancelled) }.not_to change(PayrollEntryProcessingEvent, :count)
    expect(response).to have_http_status(:ok)
    expect(json.fetch(:entry_processing)).to eq(cancellation_ack)
    expect(Payroll::EmployeePeriodEvidence.new(user: employee).call[:totals][:issued_hours]).to eq(8.0)
    post_receipt(batch, cancelled.merge(event_id: SecureRandom.uuid, occurred_at: "2026-09-05T10:00:00+10:00"))
    expect(response).to have_http_status(:conflict)
    post_receipt(batch, issued.merge(event_id: SecureRandom.uuid, occurred_at: "2026-09-06T10:00:00+10:00"))
    expect(response).to have_http_status(:conflict)
    expect(PayrollEntryProcessingEvent.count).to eq(3)
  end

  it "accepts cancellation of prepared exact instruments without claiming they were issued" do
    batch = finalized_batch
    prepared = instrument_receipt(batch, status: "payment_prepared").merge(metadata: {})
    post_receipt(batch, prepared)
    cancelled = prepared.merge(event_id: SecureRandom.uuid, status: "payment_cancelled", metadata: {
      cancelled_payment_event_id: prepared[:event_id], cancellation_evidence_reference: "DESTROYED-PAPER-1" })
    post_receipt(batch, cancelled)
    expect(response).to have_http_status(:created)
    expect(Payroll::EmployeePeriodEvidence.new(user: employee).call[:totals]).to include(committed_hours: 8.0, issued_hours: 0.0)
  end

  it "fails closed for missing or mismatched cancellation identity, evidence, hours or chronology" do
    batch = finalized_batch
    issued = instrument_receipt(batch)
    post_receipt(batch, issued)
    cancelled = issued.merge(event_id: SecureRandom.uuid, status: "payment_cancelled", metadata: issued[:metadata].merge(
      cancelled_payment_event_id: issued[:event_id], cancellation_evidence_reference: "BANK-STOP-1"))
    [ cancelled.except(:source_user_uuid), cancelled.merge(source_user_uuid: SecureRandom.uuid),
     cancelled.merge(payment_reference: "other"), cancelled.merge(external_payroll_item_id: "other"),
     cancelled.merge(total_hours: "7", regular_hours: "7"), cancelled.merge(metadata: {}),
     cancelled.merge(occurred_at: "2026-09-03T10:00:00+10:00"), cancelled.merge(occurred_at: 1.day.from_now.iso8601),
     cancelled.merge(metadata: cancelled[:metadata].merge(payment_effective_on: "2026-09-03")) ].each do |payload|
      expect { post_receipt(batch, payload) }.not_to change(PayrollEntryProcessingEvent, :count)
      expect(response.status).to be_in([ 409, 422 ])
    end
    expect(PayrollEntryProcessingEvent.count).to eq(1)
  end

  it "keeps cancellation tombstones effective even against a delayed legacy receipt inserted out of order" do
    batch = finalized_batch
    issued = instrument_receipt(batch)
    post_receipt(batch, issued)
    cancelled = issued.merge(event_id: SecureRandom.uuid, status: "payment_cancelled", metadata: issued[:metadata].merge(
      cancelled_payment_event_id: issued[:event_id], cancellation_evidence_reference: "BANK-STOP-1"))
    post_receipt(batch, cancelled)
    original = PayrollEntryProcessingEvent.find_by!(event_id: issued[:event_id])
    PayrollEntryProcessingEvent.create!(original.attributes.except("id", "created_at", "updated_at").merge(
      event_id: SecureRandom.uuid, occurred_at: original.occurred_at + 1.day))
    PayrollEntryProcessingEvent.create!(original.attributes.except("id", "created_at", "updated_at").merge(
      event_id: SecureRandom.uuid, status: "payment_failed", occurred_at: original.occurred_at + 3.days))
    [ "imported", "committed" ].each do |status|
      PayrollEntryProcessingEvent.create!(original.attributes.except("id", "created_at", "updated_at").merge(
        event_id: SecureRandom.uuid, status: status, occurred_at: original.occurred_at + 2.days,
        payment_method: nil, payment_reference: nil, contract_version: nil, source_line_key: nil, source_kind: nil,
        total_hours: nil, regular_hours: nil, overtime_hours: nil, source_user_uuid: nil))
    end
    expect(Payroll::EmployeePeriodEvidence.new(user: employee).call[:totals]).to include(issued_hours: 0.0, committed_hours: 8.0)
    expect(Payroll::EntryLifecycleResolver.new(entries: employee.time_entries.to_a).call.values.first[:status]).to eq("payment_cancelled")
  end

  it "transports dates on new issued receipts and rejects cancellation against a different known original date" do
    batch = finalized_batch
    issued = instrument_receipt(batch).merge(metadata: {}, payment_effective_on: "2026-09-04")
    post_receipt(batch, issued)
    expect(response).to have_http_status(:created)
    expect(json.dig(:entry_processing, :payment_effective_on)).to eq("2026-09-04")
    original = PayrollEntryProcessingEvent.find_by!(event_id: issued[:event_id])
    expect(original.metadata).to eq("payment_effective_on" => "2026-09-04")
    cancelled = issued.merge(event_id: SecureRandom.uuid, status: "payment_cancelled", payment_effective_on: "2026-09-03",
      occurred_at: "2026-09-04T10:00:00.123456+10:00",
      metadata: { cancelled_payment_event_id: issued[:event_id], cancellation_evidence_reference: "DATE-STOP-1" })
    expect { post_receipt(batch, cancelled) }.not_to change(PayrollEntryProcessingEvent, :count)
    expect(response).to have_http_status(:conflict)
    post_receipt(batch, cancelled.merge(payment_effective_on: "2026-09-04"))
    expect(response).to have_http_status(:created)
    expect(json.dig(:entry_processing, :payment_effective_on)).to eq("2026-09-04")
    expect(json.dig(:entry_processing, :metadata, :original_payment_effective_on_known)).to be(true)
    expect(json.dig(:entry_processing, :occurred_at)).to eq("2026-09-04T00:00:00.123456Z")
  end

  it "preserves a retained ordinary receipt with an unknown date when its old saved payload is retried after date transport is supported" do
    batch = finalized_batch
    issued = instrument_receipt(batch).merge(metadata: {})
    post_receipt(batch, issued)
    original = PayrollEntryProcessingEvent.find_by!(event_id: issued[:event_id]).attributes
    expect { post_receipt(batch, issued.merge(payment_effective_on: "2026-09-04")) }.not_to change(PayrollEntryProcessingEvent, :count)
    expect(response).to have_http_status(:ok)
    expect(json.dig(:entry_processing, :payment_effective_on)).to be_nil
    expect(json.dig(:entry_processing, :metadata)).to eq({})
    expect(PayrollEntryProcessingEvent.find_by!(event_id: issued[:event_id]).attributes).to eq(original)
    cancelled = issued.merge(event_id: SecureRandom.uuid, status: "payment_cancelled", payment_effective_on: "2026-09-04",
      metadata: { cancelled_payment_event_id: issued[:event_id], cancellation_evidence_reference: "UNKNOWN-DATE-STOP-1" })
    post_receipt(batch, cancelled)
    expect(response).to have_http_status(:created)
    acknowledgement = json.fetch(:entry_processing)
    expect(acknowledgement.fetch(:payment_effective_on)).to eq("2026-09-04")
    expect(acknowledgement.fetch(:metadata)).to include(original_payment_effective_on_known: false, original_payment_effective_on: nil)
    expect { post_receipt(batch, cancelled) }.not_to change(PayrollEntryProcessingEvent, :count)
    expect(response).to have_http_status(:ok)
    expect(json.fetch(:entry_processing)).to eq(acknowledgement)
    expect(PayrollEntryProcessingEvent.find_by!(event_id: issued[:event_id]).attributes).to eq(original)
  end
end
