# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Frozen payroll obligation corrections", type: :request do
  let(:admin) { create(:user, :admin) }
  let(:employee) { create(:user, :employee) }
  let(:category) { create(:time_category) }
  let(:secret) { "obligation-correction-test" }
  let(:headers) { { "X-Payroll-Shared-Secret" => secret } }
  let!(:entry) do
    create(:time_entry, user: employee, time_category: category, work_date: "2026-08-15",
      start_time: Time.zone.parse("2026-08-15 08:00"), end_time: Time.zone.parse("2026-08-15 12:00"),
      hours: 4, status: "completed", entry_method: "clock", approval_status: nil, overtime_status: "none")
  end
  let!(:batch) { Payroll::BatchFinalizer.new(start_date: "2026-08-01", end_date: "2026-08-15", actor: admin).call }
  let(:row) { batch.payroll_batch_entries.first }

  around do |example|
    previous = ENV["PAYROLL_SHARED_SECRET"]
    ENV["PAYROLL_SHARED_SECRET"] = secret
    example.run
  ensure
    ENV["PAYROLL_SHARED_SECRET"] = previous
  end

  def json
    JSON.parse(response.body)
  end

  def receipt(status: "committed", period: "2", item: "1", at: "2026-08-16T00:00:00.000000Z", source_entry: entry, source_row: row)
    { "event_id" => SecureRandom.uuid, "status" => status, "occurred_at" => at,
      "external_system" => "cornerstone_payroll", "external_pay_period_id" => period,
      "external_payroll_item_id" => item, "contract_version" => "2.0",
      "source_time_entry_id" => source_entry.id.to_s, "source_user_uuid" => source_row.source_user_uuid,
      "source_line_key" => source_row.line_key, "source_kind" => source_row.source_kind,
      "total_hours" => source_row.total_hours.to_s("F"), "regular_hours" => source_row.regular_hours.to_s("F"),
      "overtime_hours" => source_row.overtime_hours.to_s("F"), "metadata" => {} }
  end

  def post_receipt(payload, obligation: payload.key?("obligation_correction"))
    endpoint = obligation ? "obligation_events" : "processing_events"
    post "/api/v1/payroll/batches/#{batch.public_id}/#{endpoint}", params: payload, headers: headers, as: :json
  end

  def predecessor(source_entry: entry, source_row: row)
    original = receipt(source_entry: source_entry, source_row: source_row)
    post_receipt(original)
    expect(response).to have_http_status(:created)
    voided = receipt(status: "payment_voided", at: "2026-08-17T00:00:00.000000Z", source_entry: source_entry, source_row: source_row)
    post_receipt(voided)
    expect(response).to have_http_status(:created)
    voided
  end

  def successor(voided, source_entry: entry, source_row: row)
    payload = receipt(period: "3", item: "2", at: "2026-08-18T00:00:00.000000Z", source_entry: source_entry, source_row: source_row)
    payload["obligation_correction"] = {
      "contract" => "payroll_obligation_correction_v1", "command_id" => SecureRandom.uuid,
      "source_instance_id" => Payroll::IntegrationProfile.source_instance_id, "batch_checksum" => batch.checksum,
      "source_work_date" => source_row.work_date.iso8601, "source_time_entry_version" => source_row.snapshot["version"],
      "predecessor" => { "external_pay_period_id" => "2", "external_payroll_item_id" => "1", "payment_voided_event_id" => voided.fetch("event_id") },
      "successor" => { "external_pay_period_id" => "3", "external_payroll_item_id" => "2" },
      "financial_assertion" => { "version" => 1, "kind" => "whole_payroll_void_and_corrective_commit",
        "root_pay_period_id" => "2", "voided_pay_period_id" => "2", "successor_pay_period_id" => "3",
        "predecessor_payroll_item_id" => "1", "successor_payroll_item_id" => "2", "void_event_id" => "11",
        "correction_created_event_id" => "12", "successor_committed_event_id" => "13", "reversal_posting_ids" => [ "21" ] }
    }
    payload
  end

  it "requires a typed whole-financial assertion before accepting an alternate frozen owner" do
    old = predecessor
    unproved = successor(old).except("obligation_correction")
    expect { post_receipt(unproved) }.not_to change(PayrollEntryProcessingEvent, :count)
    expect(response).to have_http_status(:conflict)
    expect(json["error"]).to include("validated financial successor")
  end

  it "rejects a financial command on the ordinary endpoint instead of silently ignoring its binding" do
    payload = successor(predecessor)
    expect { post_receipt(payload, obligation: false) }.not_to change(PayrollEntryProcessingEvent, :count)
    expect(response).to have_http_status(:conflict)
  end

  it "rejects fractional rounding and incomplete bound-owner callbacks" do
    payload = successor(predecessor)
    rounded = payload.merge("total_hours" => "4.001", "regular_hours" => "4.001")
    post_receipt(rounded)
    expect(response).to have_http_status(:conflict)
    expect(PayrollObligationCorrection.count).to eq(0)
    post_receipt(payload)
    callback = receipt(status: "payment_prepared", period: "3", item: "2", at: "2026-08-19T00:00:00.000000Z").merge("payment_method" => "paper_check", "payment_reference" => "NEW")
    [ callback.except("contract_version", "source_line_key", "source_kind", "total_hours", "regular_hours", "overtime_hours"), callback.except("source_user_uuid") ].each do |incomplete|
      expect { post_receipt(incomplete, obligation: true) }.not_to change(PayrollEntryProcessingEvent, :count)
      expect(response).to have_http_status(:conflict)
    end
    post_receipt(callback, obligation: false)
    expect(response).to have_http_status(:conflict)
    post_receipt(callback, obligation: true)
    expect(response).to have_http_status(:created)
  end

  it "holds an alternate owner behind retained ambiguous legacy void history" do
    old = receipt(status: "payment_voided").except("contract_version", "source_line_key", "source_kind", "total_hours", "regular_hours", "overtime_hours")
    post_receipt(old)
    expect(response).to have_http_status(:created)
    alternate = receipt(period: "3", item: "2", at: "2026-08-18T00:00:00.000000Z")
    expect { post_receipt(alternate) }.not_to change(PayrollEntryProcessingEvent, :count)
    expect(response).to have_http_status(:conflict)
    post_receipt(old)
    expect(response).to have_http_status(:ok)
  end

  it "binds current committed ownership once, echoes the canonical request, and preserves old work/history" do
    old = predecessor
    old_events = PayrollEntryProcessingEvent.order(:id).map(&:attributes)
    frozen = row.attributes
    raw = batch.reload.export_payload
    payload = successor(old)
    expect { post_receipt(payload) }.to change(PayrollObligationCorrection, :count).by(1).and change(PayrollEntryProcessingEvent, :count).by(1)
    expect(response).to have_http_status(:created)
    acknowledgement = json
    expect(acknowledgement.fetch("obligation_correction")).to include("command" => payload["obligation_correction"], "request_digest" => Payroll::CanonicalPayload.checksum(payload))
    expect(acknowledgement.dig("integration", "capabilities")).to include("payroll_obligation_correction_v1")
    expect(acknowledgement.fetch("entry_processing")).to include("status" => "committed", "external_pay_period_id" => "3", "external_payroll_item_id" => "2")
    expect(Payroll::EmployeePeriodEvidence.new(user: employee).call[:totals]).to include(committed_hours: 4.0, issued_hours: 0.0, needs_reconciliation_hours: 0.0)
    expect(row.reload.attributes).to eq(frozen)
    expect(batch.reload.export_payload).to eq(raw)
    expect(PayrollEntryProcessingEvent.order(:id).limit(2).map(&:attributes)).to eq(old_events)
    expect { post_receipt(payload) }.not_to change(PayrollEntryProcessingEvent, :count)
    expect(response).to have_http_status(:ok)
    expect(json).to eq(acknowledgement)
  end

  it "rejects a changed assertion or event under a reused command without changing its original receipt" do
    payload = successor(predecessor)
    post_receipt(payload)
    original = json
    changed = payload.deep_dup
    changed["obligation_correction"]["financial_assertion"]["reversal_posting_ids"] = [ "99" ]
    expect { post_receipt(changed) }.not_to change(PayrollEntryProcessingEvent, :count)
    expect(response).to have_http_status(:conflict)
    changed = payload.merge("event_id" => SecureRandom.uuid)
    expect { post_receipt(changed) }.not_to change(PayrollEntryProcessingEvent, :count)
    expect(response).to have_http_status(:conflict)
    post_receipt(payload)
    expect(json).to eq(original)
  end

  it "rejects stripped or empty typed commands on an initial corrective commit replay" do
    payload = successor(predecessor)
    post_receipt(payload)
    [ payload.except("obligation_correction"), payload.merge("obligation_correction" => {}) ].each do |changed|
      expect { post_receipt(changed, obligation: true) }.not_to change(PayrollEntryProcessingEvent, :count)
      expect(response).to have_http_status(:conflict)
    end
  end

  it "checks exact correction replay even when the event appears only after the row lock" do
    payload = successor(predecessor)
    post_receipt(payload)
    changed = payload.deep_dup
    changed["obligation_correction"]["financial_assertion"]["reversal_posting_ids"] = [ "99" ]
    missed = false
    allow(PayrollEntryProcessingEvent).to receive(:find_by).and_wrap_original do |method, *args|
      if !missed && args.first == { event_id: payload["event_id"] }
        missed = true
        nil
      else
        method.call(*args)
      end
    end
    expect { post_receipt(changed) }.not_to change(PayrollEntryProcessingEvent, :count)
    expect(missed).to be(true)
    expect(response).to have_http_status(:conflict)
  end

  it "rejects missing financial proof, wrong installation/frozen tuple, cancellation and noncash substitutions" do
    payload = successor(predecessor)
    mutations = [
      ->(p) { p["obligation_correction"]["financial_assertion"]["reversal_posting_ids"] = [] },
      ->(p) { p["obligation_correction"]["financial_assertion"]["kind"] = "payment_cancelled" },
      ->(p) { p["obligation_correction"]["source_instance_id"] = SecureRandom.uuid },
      ->(p) { p["obligation_correction"]["batch_checksum"] = "0" * 64 },
      ->(p) { p["obligation_correction"]["source_time_entry_version"] = "0" },
      ->(p) { p["obligation_correction"]["source_work_date"] = "2026-08-16" },
      ->(p) { p["obligation_correction"]["financial_assertion"]["successor_pay_period_id"] = "99" },
      ->(p) { p["obligation_correction"]["predecessor"]["payment_voided_event_id"] = SecureRandom.uuid },
      ->(p) { p["metadata"] = { "accounting_only" => true } },
      ->(p) { p["regular_hours"] = "3.0"; p["overtime_hours"] = "1.0" },
      ->(p) { p["source_user_uuid"] = SecureRandom.uuid }
    ]
    mutations.each do |mutation|
      changed = payload.deep_dup
      mutation.call(changed)
      expect { post_receipt(changed) }.not_to change(PayrollEntryProcessingEvent, :count)
      expect(response).to have_http_status(:conflict), response.body
    end
    expect(PayrollObligationCorrection.count).to eq(0)
  end

  it "holds changed current source work without changing frozen history" do
    payload = successor(predecessor)
    entry.update!(description: "Changed after the freeze")
    post_receipt(payload)
    expect(response).to have_http_status(:conflict)
    expect(json["error"]).to include("Current source work changed")
    expect(PayrollObligationCorrection.count).to eq(0)
  end

  it "has one successor even when a competing command arrives for the same old owner" do
    old = predecessor
    payload = successor(old)
    post_receipt(payload)
    alternate = successor(old)
    alternate["external_pay_period_id"] = "4"
    alternate["external_payroll_item_id"] = "3"
    alternate["obligation_correction"]["successor"] = { "external_pay_period_id" => "4", "external_payroll_item_id" => "3" }
    alternate["obligation_correction"]["financial_assertion"]["successor_pay_period_id"] = "4"
    alternate["obligation_correction"]["financial_assertion"]["successor_payroll_item_id"] = "3"
    expect { post_receipt(alternate) }.not_to change(PayrollObligationCorrection, :count)
    expect(response).to have_http_status(:conflict)
    expect(PayrollObligationCorrection.count).to eq(1)
  end

  it "keeps old-owner tombstones authoritative and later callback receipts on the actual successor" do
    old = predecessor
    payload = successor(old)
    post_receipt(payload)
    binding = json.fetch("obligation_correction")
    late = receipt(status: "payment_issued", at: "2026-08-25T00:00:00.000000Z").merge("payment_method" => "paper_check", "payment_reference" => "OLD")
    expect { post_receipt(late) }.not_to change(PayrollEntryProcessingEvent, :count)
    expect(response).to have_http_status(:conflict)
    [ "payment_prepared", "payment_issued" ].each_with_index do |status, index|
      next_receipt = receipt(status: status, period: "3", item: "2", at: "2026-08-#{19 + index}T00:00:00.000000Z").merge("payment_method" => "paper_check", "payment_reference" => "NEW")
      post_receipt(next_receipt, obligation: true)
      expect(response).to have_http_status(:created)
      expect(json.fetch("obligation_correction")).to eq(binding)
    end
    evidence = Payroll::EmployeePeriodEvidence.new(user: employee).call
    expect(evidence[:totals]).to include(issued_hours: 4.0, committed_hours: 0.0, needs_reconciliation_hours: 0.0)
    lifecycle = Payroll::EntryLifecycleResolver.new(entries: [ entry ]).call[entry.id]
    expect(lifecycle[:settlements].first).to include(status: "payment_issued", external_pay_period_id: "3", external_payroll_item_id: "2", total_hours: 4.0)
    post_receipt(receipt(period: "3", item: "2", at: "2026-08-26T00:00:00.000000Z"), obligation: true)
    expect(response).to have_http_status(:conflict)
    post_receipt(old)
    expect(response).to have_http_status(:ok)
    expect(Payroll::EmployeePeriodEvidence.new(user: employee).call[:totals][:issued_hours]).to eq(4.0)
  end

  it "rolls back the lineage if its committed receipt fails validation" do
    payload = successor(predecessor)
    payload["event_id"] = "x" * 201
    expect { post_receipt(payload) }.not_to change(PayrollObligationCorrection, :count)
    expect(response).to have_http_status(:unprocessable_entity)
  end

  context "when different frozen rows compete for a global correction command" do
    let!(:other_entry) do
      create(:time_entry, user: employee, time_category: category, work_date: "2026-08-14",
        start_time: Time.zone.parse("2026-08-14 08:00"), end_time: Time.zone.parse("2026-08-14 12:00"),
        hours: 4, status: "completed", entry_method: "clock", approval_status: nil, overtime_status: "none")
    end
    let!(:batch) { other_entry; super() }
    let(:row) { batch.payroll_batch_entries.find_by!(source_time_entry_id: entry.id) }
    let(:other_row) { batch.payroll_batch_entries.find_by!(source_time_entry_id: other_entry.id) }

    it "returns a conflict for the database uniqueness race without changing either row or its accepted replay" do
      winner = successor(predecessor)
      post_receipt(winner)
      expect(response).to have_http_status(:created)
      accepted = json
      contender = successor(predecessor(source_entry: other_entry, source_row: other_row), source_entry: other_entry, source_row: other_row)
      contender["obligation_correction"]["command_id"] = winner.dig("obligation_correction", "command_id")
      retained = [ PayrollObligationCorrection, PayrollEntryProcessingEvent, PayrollBatchEntry, AuditLog ].to_h do |model|
        [ model, model.order(:id).map(&:attributes) ]
      end

      # Two independently locked rows can both observe an absent command before
      # either insert commits. Skip only that stale application-level uniqueness
      # observation, so PostgreSQL's actual unique index decides the collision.
      allow(PayrollObligationCorrection).to receive(:find_by).with(command_id: winner.dig("obligation_correction", "command_id")).and_return(nil)
      collision = false
      allow(PayrollObligationCorrection).to receive(:create!).and_wrap_original do |method, **attributes|
        next method.call(**attributes) unless attributes[:payroll_batch_entry] == other_row

        collision = true
        correction = PayrollObligationCorrection.new(attributes)
        correction.save!(validate: false)
        correction
      end
      post_receipt(contender)
      expect(collision).to be(true)
      expect(response).to have_http_status(:conflict)
      expect(json.fetch("error")).to include("Correction command or predecessor already has a successor")
      retained.each { |model, attributes| expect(model.order(:id).map(&:attributes)).to eq(attributes) }
      expect(PayrollEntryProcessingEvent.exists?(event_id: contender.fetch("event_id"))).to be(false)

      post_receipt(winner)
      expect(response).to have_http_status(:ok)
      expect(json).to eq(accepted)
    end
  end

  it "makes both the lineage and frozen work immutable in PostgreSQL" do
    post_receipt(successor(predecessor))
    link = PayrollObligationCorrection.first
    expect(link).to be_readonly
    [ "UPDATE payroll_obligation_corrections SET successor_pay_period_id = '99' WHERE id = #{link.id}",
      "DELETE FROM payroll_obligation_corrections WHERE id = #{link.id}", "TRUNCATE payroll_obligation_corrections CASCADE" ].each do |sql|
      expect { ApplicationRecord.transaction(requires_new: true) { ApplicationRecord.connection.execute(sql) } }.to raise_error(ActiveRecord::StatementInvalid, /append-only/)
    end
    attributes = link.attributes.except("id")
    expect { ApplicationRecord.transaction(requires_new: true) { PayrollObligationCorrection.insert_all!([ attributes.merge("command_id" => SecureRandom.uuid) ]) } }.to raise_error(ActiveRecord::RecordNotUnique)
  end
end
