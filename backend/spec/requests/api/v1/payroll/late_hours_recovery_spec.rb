# frozen_string_literal: true

require "rails_helper"
require_relative "../../../../support/payroll_clock_helpers"

RSpec.describe "Payroll late-hours recovery and conservation", type: :request do
  include PayrollClockHelpers

  let(:actor) { create(:user, :admin, is_active: true, personal_access_enabled: true) }
  let(:worker) { create(:user, :employee) }
  let(:category) { create(:time_category) }
  let(:guam) { ActiveSupport::TimeZone["Pacific/Guam"] }
  let(:dates) { payroll_calendar_at(database_clock) }
  let(:grant) { PayrollIntegrationGrant.issue!(user: actor, capabilities: [ "settlement_case_management" ]) }
  let(:secret) { "late-hours-test-secret" }

  around do |example|
    previous_secret = ENV["PAYROLL_SHARED_SECRET"]
    ENV["PAYROLL_SHARED_SECRET"] = secret
    example.run
  ensure
    ENV["PAYROLL_SHARED_SECRET"] = previous_secret
  end

  let(:headers) do
    { "X-Payroll-Shared-Secret" => secret,
      "X-Aire-Delegation-Token" => grant.issued_token, "Content-Type" => "application/json" }
  end
  let(:source) do
    create(:time_entry, user: worker, time_category: category, work_date: dates[:start_date] + 2.days,
      start_time: guam.local(2000, 1, 1, 8), end_time: guam.local(2000, 1, 1, 12),
      entry_method: "manual", status: "completed", approval_status: "pending", overtime_status: "none")
  end
  let(:origin) do
    source
    period = create(:payroll_calendar_period, **payroll_calendar_at(capture_payroll_cutoff))
    wait_for_database_cutoff(period.cutoff_at)
    expect(Payroll::ScheduledCutoffFinalizer.new(period_id: period.id).call[:status]).to eq("finalized")
    period.reload
  end
  let(:held) { origin; PayrollSettlementCase.find_by!(source_time_entry_id: source.id) }
  let(:path) { "/api/v1/payroll/cockpit/periods/#{origin.external_pay_period_id}/late_hours" }

  def approve!
    held
    TimeClockService.approve_entry(entry: source.reload, approved_by: actor, note: "Verified four hours after cutoff")
  end

  def json
    response.parsed_body
  end

  def payload
    { command_id: SecureRandom.uuid, expected_version: origin.reload.lock_version,
      reason: "Pay approved late hours in a separate adjustment", target_external_pay_period_id: "901",
      pay_date: database_clock.to_date.iso8601, cases: [ { id: held.public_id, version: held.reload.lock_version } ] }
  end

  def claim!(parameters = payload)
    post path, params: parameters.to_json, headers: headers
  end

  def receipt!(batch, row, status:, index: 0, target: "901")
    post "/api/v1/payroll/batches/#{batch.public_id}/processing_events", params: {
      event_id: SecureRandom.uuid, status: status, occurred_at: Time.current.iso8601(6),
      external_system: "cornerstone_payroll", external_pay_period_id: target, external_payroll_item_id: "1001",
      source_time_entry_id: row.source_time_entry_id.to_s, source_user_uuid: row.source_user_uuid,
      contract_version: PayrollEntryProcessingEvent::LINE_CONTRACT_VERSION,
      source_line_key: row.line_key, source_kind: row.source_kind,
      total_hours: row.total_hours.to_s, regular_hours: row.regular_hours.to_s, overtime_hours: row.overtime_hours.to_s,
      payment_method: status == "payment_issued" ? "paper_check" : nil,
      payment_reference: status == "payment_issued" ? "SYNTHETIC-#{index}" : nil
    }.to_json, headers: headers
    expect(response).to have_http_status(:created)
  end

  def overnight!
    from = payroll_time(dates[:end_date], hour: 22)
    source.update!(entry_method: "clock", work_date: dates[:end_date], start_time: from, end_time: from + 4.hours,
      clock_in_at: from, clock_out_at: from + 4.hours)
  end

  def command_body(**extra)
    { command_id: SecureRandom.uuid, expected_version: origin.reload.lock_version,
      reason: "Reviewed saved claim and confirmed its source and destination", target_external_pay_period_id: "901" }.merge(extra)
  end

  def recover!(original, body = command_body, caller_headers = headers)
    post "#{path}/#{original.fetch(:command_id)}/recover", params: body.to_json, headers: caller_headers
  end

  def cancel!(original, batch, body = command_body, caller_headers = headers)
    post "#{path}/#{original.fetch(:command_id)}/cancel", params: body.merge(
      expected_batch_id: batch.public_id, confirm_unapplied: true
    ).to_json, headers: caller_headers
  end

  def exact_body(row, status:, target: "901", item: "1001")
    { event_id: SecureRandom.uuid, status: status, occurred_at: Time.current.iso8601(6),
      external_system: "cornerstone_payroll", external_pay_period_id: target, external_payroll_item_id: item,
      source_time_entry_id: row.source_time_entry_id.to_s, source_user_uuid: row.source_user_uuid,
      contract_version: "2.0", source_line_key: row.line_key, source_kind: row.source_kind,
      total_hours: row.total_hours.to_s, regular_hours: row.regular_hours.to_s, overtime_hours: row.overtime_hours.to_s,
      metadata: {} }.tap do |body|
      if status.in?(%w[payment_prepared payment_issued])
        body.merge!(payment_method: "paper_check", payment_reference: "SYNTHETIC-SUCCESSOR")
      end
    end
  end

  def submit_receipt(batch, body, obligation: false)
    endpoint = obligation ? "obligation_events" : "processing_events"
    post "/api/v1/payroll/batches/#{batch.public_id}/#{endpoint}", params: body.to_json, headers: headers
  end

  def correction_body(batch, row, void_event)
    exact_body(row, status: "committed", target: "902", item: "1002").merge(obligation_correction: {
      contract: "payroll_obligation_correction_v1", command_id: SecureRandom.uuid,
      source_instance_id: Payroll::IntegrationProfile.source_instance_id, batch_checksum: batch.checksum,
      source_work_date: row.work_date.iso8601, source_time_entry_version: row.snapshot.fetch("version"),
      predecessor: { external_pay_period_id: "901", external_payroll_item_id: "1001", payment_voided_event_id: void_event.event_id },
      successor: { external_pay_period_id: "902", external_payroll_item_id: "1002" },
      financial_assertion: { version: 1, kind: "whole_payroll_void_and_corrective_commit",
        root_pay_period_id: "901", voided_pay_period_id: "901", successor_pay_period_id: "902",
        predecessor_payroll_item_id: "1001", successor_payroll_item_id: "1002", void_event_id: "11",
        correction_created_event_id: "12", successor_committed_event_id: "13", reversal_posting_ids: [ "21" ] }
    })
  end

  %w[denied open pending positive].each do |frozen_state|
    %w[claim_first finalizer_first].each do |ordering|
      it "conserves #{frozen_state} split work with #{ordering} and never reverses a later claim" do
        overnight!
        held
        # Keep this origin case explicitly unassigned while the due period locks.
        held.payroll_settlement_case_events.create!(event_id: SecureRandom.uuid, event_type: "rerouted",
          to_status: "open", occurred_at: Time.current, metadata: { requires_explicit_routing: true })
        case frozen_state
        when "denied" then source.update!(approval_status: "denied")
        when "open" then source.update!(status: "clocked_in", end_time: nil, clock_out_at: nil, hours: 0)
        when "positive" then TimeClockService.approve_entry(entry: source.reload, approved_by: actor, note: "Approved before due cutoff")
        end
        cutoff = capture_payroll_cutoff
        next_dates = payroll_calendar_for(next_payroll_start(origin.start_date))
        payday = next_dates[:end_date] + 1.day
        due = create(:payroll_calendar_period, **next_dates.merge(pay_date: payday, cutoff_at: cutoff,
          next_finalization_attempt_at: cutoff), schema_version: "2.0", cutoff_rule: "before_pay_date",
          cutoff_days: (payday - cutoff.to_date).to_i)
        wait_for_database_cutoff(cutoff)
        from = payroll_time(dates[:end_date], hour: 22)
        source.reload.update!(status: "completed", end_time: from + 4.hours, clock_out_at: from + 4.hours,
          approval_status: "pending", approved_at: nil, approved_by: nil)
        TimeClockService.approve_entry(entry: source.reload, approved_by: actor, note: "Reviewed after delayed cutoff")
        original = origin.payroll_batch.attributes
        if ordering == "claim_first"
          claim!
          expect(response).to have_http_status(:conflict)
          expect(json.fetch("error")).to include(due.external_pay_period_id)
        end
        expect(Payroll::ScheduledCutoffFinalizer.new(period_id: due.id).call[:status]).to eq("finalized")
        claim!(payload.merge(command_id: SecureRandom.uuid))
        expect(response).to have_http_status(frozen_state == "positive" ? :conflict : :created)
        rows = PayrollBatchEntry.where(source_time_entry_id: source.id)
        expect(rows.sum(:total_hours)).to eq(4)
        expect(rows.any? { |row| row.total_hours.negative? || row.regular_hours.negative? || row.overtime_hours.negative? }).to be(false)
        expect(origin.payroll_batch.reload.attributes).to eq(original)
      end
    end
  end

  it "accepts exact split-line financial successors and derives paid from the validated current owner" do
    overnight!
    approve!
    claim!
    expect(response).to have_http_status(:created)
    batch = held.reload.included_payroll_batch
    immutable = batch.attributes
    rows = batch.payroll_batch_entries.order(:work_date).to_a
    expect(rows.size).to eq(2)
    rows.each do |row|
      submit_receipt(batch, exact_body(row, status: "committed"))
      expect(response).to have_http_status(:created)
      submit_receipt(batch, exact_body(row, status: "payment_voided"))
      expect(response).to have_http_status(:created)
      void_event = batch.payroll_entry_processing_events.where(source_line_key: row.line_key, status: "payment_voided").sole
      body = correction_body(batch, row, void_event)
      submit_receipt(batch, body, obligation: true)
      expect(response).to have_http_status(:created)
      submit_receipt(batch, body, obligation: true)
      expect(response).to have_http_status(:ok)
      submit_receipt(batch, exact_body(row, status: "payment_prepared", target: "902", item: "1002"))
      expect(response).to have_http_status(:created)
      expect(Payroll::SettlementCaseCompletion.new(settlement_case: held.reload, entry: source.reload).call).to be_nil
      submit_receipt(batch, exact_body(row, status: "payment_issued", target: "902", item: "1002"))
      expect(response).to have_http_status(:created)
    end
    expect(Payroll::SettlementCaseCompletion.new(settlement_case: held.reload, entry: source.reload).call).to eq("paid")
    expect(PayrollObligationCorrection.count).to eq(2)
    expect(batch.reload.attributes).to eq(immutable)
    rows.each do |row|
      submit_receipt(batch, exact_body(row, status: "payment_prepared"))
      expect(response).to have_http_status(:conflict)
      submit_receipt(batch, exact_body(row, status: "payment_issued", target: "903", item: "1003"))
      expect(response).to have_http_status(:conflict)
    end
  end

  it "replays retained original-owner receipts after split-line financial succession without accepting new stale-owner evidence" do
    overnight!
    approve!
    claim!
    batch = held.reload.included_payroll_batch
    batch.payroll_batch_entries.order(:work_date).each do |row|
      original = exact_body(row, status: "committed")
      submit_receipt(batch, original)
      expect(response).to have_http_status(:created)
      expect(json.fetch("replayed")).to be(false)
      stored = json.fetch("entry_processing")
      submit_receipt(batch, exact_body(row, status: "payment_voided"))
      expect(response).to have_http_status(:created)
      void_event = batch.payroll_entry_processing_events.where(source_line_key: row.line_key, status: "payment_voided").sole
      submit_receipt(batch, correction_body(batch, row, void_event), obligation: true)
      expect(response).to have_http_status(:created)
      retained = batch.payroll_entry_processing_events.order(:id).map(&:attributes)

      expect { submit_receipt(batch, original) }.not_to change(PayrollEntryProcessingEvent, :count)
      expect(response).to have_http_status(:ok)
      expect(json).to include("replayed" => true, "entry_processing" => stored)
      [ original.merge(external_pay_period_id: "902"), original.merge(status: "payment_voided"),
        original.merge(metadata: { changed: true }), original.merge(occurred_at: 1.minute.ago.iso8601(6)) ].each do |changed|
        submit_receipt(batch, changed)
        expect(response).to have_http_status(:conflict)
      end
      submit_receipt(batch, original.merge(event_id: SecureRandom.uuid))
      expect(response).to have_http_status(:conflict)
      expect(batch.payroll_entry_processing_events.order(:id).map(&:attributes)).to eq(retained)
    end
  end

  it "refuses alternate initial owners and invalid correction roots, predecessors and source versions" do
    approve!
    claim!
    batch = held.reload.included_payroll_batch
    row = batch.payroll_batch_entries.sole
    submit_receipt(batch, exact_body(row, status: "committed", target: "902", item: "1002"))
    expect(response).to have_http_status(:conflict)
    receipt!(batch, row, status: "committed")
    receipt!(batch, row, status: "payment_voided")
    void_event = batch.payroll_entry_processing_events.where(status: "payment_voided").sole
    valid = correction_body(batch, row, void_event)
    [ { financial_assertion: "malformed assertion" },
      { financial_assertion: { root_pay_period_id: "999" } },
      { predecessor: { external_pay_period_id: "999" } },
      { source_time_entry_version: row.snapshot["version"] + 1 } ].each do |bad|
      submit_receipt(batch, valid.deep_merge(obligation_correction: bad), obligation: true)
      expect(response).to have_http_status(:conflict)
    end
    expect(PayrollObligationCorrection.count).to eq(0)
  end

  it "recovers the identical lost snapshot as B after A is revoked without weakening actor-bound replay" do
    approve!
    original = payload
    claim!(original)
    expect(response).to have_http_status(:created)
    snapshot = json.fetch("payroll_batch")
    other = create(:user, :admin, is_active: true, personal_access_enabled: true)
    other_grant = PayrollIntegrationGrant.issue!(user: other, capabilities: [ "settlement_case_management" ])
    caller = headers.merge("X-Aire-Delegation-Token" => other_grant.issued_token)
    grant.update!(active: false)
    actor.update!(is_active: false)
    recover_body = command_body
    recover!(original, recover_body, caller)
    expect(response).to have_http_status(:ok)
    expect(json).to include("status" => "claimed", "payroll_batch" => snapshot)
    recover!(original, recover_body, caller)
    expect(response).to have_http_status(:ok)
    expect(json.dig("command", "replayed")).to be(true)
    post path, params: original.to_json, headers: caller
    expect(response).to have_http_status(:conflict)
    expect(PayrollBatch.count).to eq(2)
    expect(AuditLog.where(action: "payroll_late_hours.recovered", user_id: other.id).count).to eq(1)
  end

  it "durably fences an absent command and target before returning no_claim, including delayed original delivery" do
    approve!
    original = payload
    recover_body = command_body
    recover!(original, recover_body)
    expect(response).to have_http_status(:ok)
    expect(json.fetch("status")).to eq("no_claim")
    expect(json).not_to have_key("payroll_batch")
    recover!(original, recover_body)
    expect(json.dig("command", "replayed")).to be(true)
    claim!(original)
    expect(response).to have_http_status(:conflict)
    claim!(payload)
    expect(response).to have_http_status(:conflict)
    expect(PayrollBatch.count).to eq(1)
    claim!(payload.merge(target_external_pay_period_id: "902"))
    expect(response).to have_http_status(:created)
  end

  it "retires an authoritative stale rejection and permits a fresh selection on a new destination" do
    approve!
    original = payload
    source.update!(description: "Changed after displayed selection")
    claim!(original)
    expect(response).to have_http_status(:conflict)
    recover!(original)
    expect(response).to have_http_status(:ok)
    expect(json.fetch("status")).to eq("no_claim")
    claim!(payload.merge(target_external_pay_period_id: "902"))
    expect(response).to have_http_status(:created)
  end

  it "cancels only an unapplied claim, keeps immutable evidence, releases cases and excludes canceled rows economically" do
    overnight!
    approve!
    original = payload
    claim!(original)
    batch = held.reload.included_payroll_batch
    immutable = [ batch.attributes, batch.payroll_batch_entries.order(:id).map(&:attributes) ]
    cancel_body = command_body
    cancel!(original, batch, cancel_body)
    expect(response).to have_http_status(:ok)
    expect(json.fetch("status")).to eq("canceled")
    expect(held.reload).to have_attributes(status: "open", destination_kind: "unassigned", included_payroll_batch_id: nil)
    expect([ batch.reload.attributes, batch.payroll_batch_entries.order(:id).map(&:attributes) ]).to eq(immutable)
    cancel!(original, batch, cancel_body)
    expect(json.dig("command", "replayed")).to be(true)
    recover!(original)
    expect(json.fetch("status")).to eq("canceled")
    claim!(original)
    expect(response).to have_http_status(:conflict)
    submit_receipt(batch, exact_body(batch.payroll_batch_entries.first, status: "imported"))
    expect(response).to have_http_status(:conflict)
    get path, headers: headers
    expect(json.fetch("cases").sole.fetch("total_hours")).to eq(4)
    claim!(payload.merge(target_external_pay_period_id: "902"))
    expect(response).to have_http_status(:created)
    expect(PayrollBatchEntry.effective.where(source_time_entry_id: source.id).sum(:total_hours)).to eq(4)
    expect(PayrollBatchEntry.where(source_time_entry_id: source.id).sum(:total_hours)).to eq(8)
    expect(Payroll::EntryLifecycleResolver.new(entries: [ source.reload ]).call.fetch(source.id)[:settlements].map { |s| s[:batch_id] }).not_to include(batch.public_id)
  end

  %w[imported committed payment_prepared payment_issued].each do |status|
    it "refuses retirement after any #{status} evidence even if wages appear unpaid" do
      approve!
      original = payload
      claim!(original)
      batch = held.reload.included_payroll_batch
      submit_receipt(batch, exact_body(batch.payroll_batch_entries.sole, status: status))
      expect(response).to have_http_status(:created)
      cancel!(original, batch)
      expect(response).to have_http_status(:conflict)
      expect(held.reload.included_payroll_batch_id).to eq(batch.id)
    end
  end

  it "validates original command, origin, target, caller capability and cancellation confirmation" do
    approve!
    original = payload
    claim!(original)
    batch = held.reload.included_payroll_batch
    recover!(original, command_body(target_external_pay_period_id: "999"))
    expect(response).to have_http_status(:conflict)
    recover!(original.merge(command_id: SecureRandom.uuid))
    expect(response).to have_http_status(:conflict)
    limited = PayrollIntegrationGrant.issue!(user: actor, capabilities: [ "time_approval" ])
    recover!(original, command_body, headers.merge("X-Aire-Delegation-Token" => limited.issued_token))
    expect(response).to have_http_status(:forbidden)
    post "#{path}/#{original[:command_id]}/cancel", params: command_body.merge(
      expected_batch_id: batch.public_id, confirm_unapplied: false).to_json, headers: headers
    expect(response).to have_http_status(:unprocessable_entity)
    cancel!(original, batch, command_body(reason: ""))
    expect(response).to have_http_status(:unprocessable_entity)
    expect(held.reload.included_payroll_batch_id).to eq(batch.id)
  end

  it "rolls back retirement and case releases if an audited transition fails" do
    approve!
    original = payload
    claim!(original)
    batch = held.reload.included_payroll_batch
    allow(Payroll::SettlementCaseCoordinator).to receive(:transition!).and_raise(Payroll::CockpitCommand::ConflictError, "Synthetic failed release")
    cancel!(original, batch)
    expect(response).to have_http_status(:conflict)
    expect(PayrollLateHoursRetirement.count).to eq(0)
    expect(held.reload).to have_attributes(status: "in_payroll", included_payroll_batch_id: batch.id)
    recover!(original)
    expect(json.fetch("status")).to eq("claimed")
  end

  it "refuses wrong origins and expected batches without leaving terminal records" do
    approve!
    original = payload
    claim!(original)
    batch = held.reload.included_payroll_batch
    post "#{path}/#{original[:command_id]}/cancel", params: command_body.merge(
      expected_batch_id: "AIRE-SUP-wrong", confirm_unapplied: true).to_json, headers: headers
    expect(response).to have_http_status(:conflict)
    other = create(:payroll_calendar_period, **payroll_calendar_for(next_payroll_start(origin.start_date)))
    post "/api/v1/payroll/cockpit/periods/#{other.external_pay_period_id}/late_hours/#{original[:command_id]}/recover",
      params: command_body.to_json, headers: headers
    expect(response).to have_http_status(:conflict)
    expect(PayrollLateHoursRetirement.count).to eq(0)
    expect(held.reload.included_payroll_batch_id).to eq(batch.id)
  end

  it "retains an append-only terminal audit and refuses to expose its canceled export" do
    approve!
    original = payload
    claim!(original)
    batch = held.reload.included_payroll_batch
    cancel!(original, batch)
    retirement = PayrollLateHoursRetirement.sole
    expect { retirement.update!(reason: "rewrite") }.to raise_error(ActiveRecord::ReadOnlyRecord)
    %w[UPDATE DELETE TRUNCATE].each do |operation|
      expect do
        ActiveRecord::Base.transaction(requires_new: true) do
          sql = case operation
          when "UPDATE" then "UPDATE payroll_late_hours_retirements SET reason = 'rewrite'"
          when "DELETE" then "DELETE FROM payroll_late_hours_retirements"
          else "TRUNCATE payroll_late_hours_retirements"
          end
          ActiveRecord::Base.connection.execute(sql)
        end
      end.to raise_error(ActiveRecord::StatementInvalid, /immutable|append.only|cannot|not allowed/i)
    end
    get "/api/v1/payroll/batches/#{batch.public_id}", headers: headers
    expect(response).to have_http_status(:gone)
    expect(json).not_to have_key("employees")
  end

  it "rolls back a supplemental binding sent to the wrong receipt endpoint" do
    approve!
    claim!
    batch = held.reload.included_payroll_batch
    row = batch.payroll_batch_entries.sole
    receipt!(batch, row, status: "committed")
    receipt!(batch, row, status: "payment_voided")
    void_event = batch.payroll_entry_processing_events.where(status: "payment_voided").sole
    body = correction_body(batch, row, void_event)
    submit_receipt(batch, body)
    expect(response).to have_http_status(:conflict)
    expect(PayrollObligationCorrection.count).to eq(0)
    expect(batch.payroll_entry_processing_events.where(event_id: body[:event_id])).to be_empty
    submit_receipt(batch, body, obligation: true)
    expect(response).to have_http_status(:created)
  end
end
