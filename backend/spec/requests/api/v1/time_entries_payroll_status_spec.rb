# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Employee time-entry payment visibility", type: :request do
  let(:employee) { create(:user, :employee) }
  let(:admin) { create(:user, :admin) }
  let(:category) { create(:time_category) }
  let(:headers) { { "Authorization" => "Bearer test_token_#{employee.id}" } }
  let(:batch) { create(:payroll_batch) }

  def entry(**attributes)
    create(:time_entry, user: employee, time_category: category, status: "completed",
      entry_method: "clock", clock_source: "legacy", approval_status: "approved", overtime_status: "none", **attributes)
  end

  def receipt(source, status, hours: source.hours, line_key: "work", payroll_batch: batch, **attributes)
    row = payroll_batch.payroll_batch_entries.create!(source_time_entry_id: source.id, source_user_id: source.user_id,
      source_user_uuid: source.user.payroll_integration_uuid, source_category_id: source.time_category_id,
      work_date: source.work_date, week_start: source.work_date.beginning_of_week(:sunday), source_kind: "current",
      line_key: line_key, total_hours: hours, regular_hours: hours, overtime_hours: 0, snapshot: {})
    PayrollEntryProcessingEvent.create!(payroll_batch: payroll_batch, event_id: SecureRandom.uuid,
      source_time_entry_id: source.id, source_user_uuid: row.source_user_uuid,
      contract_version: "2.0", source_line_key: row.line_key, source_kind: row.source_kind,
      total_hours: hours, regular_hours: hours, overtime_hours: 0, status: status,
      external_system: "cornerstone_payroll", external_pay_period_id: "test-period", external_payroll_item_id: "test-item",
      payment_method: "check", payment_reference: "PRIVATE-TEST-REFERENCE", occurred_at: Time.current, **attributes)
  end

  def status_for(source)
    get "/api/v1/time_entries/#{source.id}", headers: headers
    expect(response).to have_http_status(:ok)
    response.parsed_body.fetch("time_entry").fetch("payroll_status")
  end

  {
    "payment_issued" => "Paid", "payment_prepared" => "Check prepared — not paid yet",
    "payment_cancelled" => "Payment cancelled", "payment_voided" => "Payment voided",
    "committed" => "In payroll — not paid yet", "imported" => "In payroll — not paid yet",
    "payment_failed" => "Payment needs attention"
  }.each do |state, label|
    it "shows #{state} from the existing lifecycle without private payment evidence" do
      source = entry
      receipt(source, state)
      expected = { "status" => state, "label" => label, "paid_hours" => state == "payment_issued" ? 8.0 : 0.0, "held_hours" => 0.0 }
      expect(status_for(source)).to eq(expected)
      get "/api/v1/time_entries", headers: headers
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body.fetch("time_entries").sole.fetch("payroll_status")).to eq(expected)
      expect(response.body).not_to include("PRIVATE-TEST-REFERENCE", "test-period", "test-item", "settlements", "payment_reference", "attestation")
    end
  end

  it "does not confuse approval or missing payroll data with issued payment" do
    approved = entry
    pending = entry(approval_status: "pending")
    expect(status_for(approved)).to eq("status" => "ready_for_cutoff", "label" => "Approved — not paid yet", "paid_hours" => 0.0, "held_hours" => 0.0)
    expect(status_for(pending)).to include("status" => "awaiting_approval", "label" => "Not in payroll — awaiting approval", "paid_hours" => 0.0)
  end

  it "shows a historical manual commit neutrally without claiming payment" do
    source = entry
    receipt(source, "committed", external_system: "cornerstone_payroll_manual")
    expect(status_for(source)).to include("status" => "payment_history_unavailable", "label" => "Payment history unavailable", "paid_hours" => 0.0)
  end

  it "keeps a reported historical payment held until exact payment evidence exists" do
    source = entry
    Payroll::PaymentAttestationRecorder.new(actor: admin).attest!(entry: source,
      source_user_uuid: employee.payroll_integration_uuid, reason: "Private test evidence pending reconciliation")
    expect(status_for(source)).to eq("status" => "payment_attested_pending_evidence", "label" => "On hold — payment confirmation pending", "paid_hours" => 0.0, "held_hours" => 8.0)
    expect(response.body).not_to include("Private test evidence", "payment_attestation", "attested_at")
  end

  it "shows paid regular hours and held overtime separately" do
    source = entry
    receipt(source, "payment_issued", hours: 6)
    batch.payroll_batch_exclusions.create!(source_time_entry_id: source.id, source_user_id: employee.id,
      source_user_uuid: employee.payroll_integration_uuid,
      reason: "pending_overtime", held_total_hours: 2, held_regular_hours: 0, held_overtime_hours: 2, snapshot: {})
    expect(status_for(source)).to include("status" => "partially_paid", "label" => "Partly paid", "paid_hours" => 6.0, "held_hours" => 2.0)
    receipt(source, "payment_issued", hours: 2, line_key: "overtime")
    expect(status_for(source)).to include("status" => "payment_issued", "paid_hours" => 8.0, "held_hours" => 0.0)
  end

  it "shows a retained cutoff hold without treating it as payroll or payment" do
    source = entry
    batch.payroll_batch_exclusions.create!(source_time_entry_id: source.id, source_user_id: employee.id,
      source_user_uuid: employee.payroll_integration_uuid, reason: "approved_after_cutoff",
      held_total_hours: 8, held_regular_hours: 8, held_overtime_hours: 0, snapshot: {})
    expect(status_for(source)).to eq("status" => "held", "label" => "On hold — awaiting payroll", "paid_hours" => 0.0, "held_hours" => 8.0)
  end

  it "explains an approval hold without changing its status or source quantities" do
    source = entry(approval_status: "pending")
    batch.payroll_batch_exclusions.create!(source_time_entry_id: source.id, source_user_id: employee.id,
      source_user_uuid: employee.payroll_integration_uuid, reason: "pending_approval",
      held_total_hours: 8, held_regular_hours: 8, held_overtime_hours: 0, snapshot: {})
    expect(status_for(source)).to eq("status" => "held", "label" => "On hold — needs manager approval", "paid_hours" => 0.0, "held_hours" => 8.0)
    expect(source.reload.approval_status).to eq("pending")
  end

  it "does not invent payment history for uncovered entries inside the existing legacy fence" do
    boundary = Date.current.beginning_of_month
    PayrollLockRollout.configure!(starts_on: boundary, actor: "test", reason: "Synthetic historical test boundary")
    source = entry(work_date: boundary - 1.day)
    batch.payroll_batch_processing_events.create!(event_id: SecureRandom.uuid, status: "committed",
      external_system: "cornerstone_payroll_manual", external_pay_period_id: "test-history", occurred_at: Time.current)
    expect(status_for(source)).to include("status" => "payment_history_unavailable", "paid_hours" => 0.0)
  end

  it "shows exact paid and prepared quantities as partial payment" do
    source = entry
    receipt(source, "payment_issued", hours: 6)
    receipt(source, "payment_prepared", hours: 2, line_key: "training")
    expect(status_for(source)).to include("status" => "partially_paid", "label" => "Partly paid", "paid_hours" => 6.0)
  end

  {
    "payment_prepared" => [ "partially_paid", "Partly paid" ],
    "payment_cancelled" => [ "payment_cancelled", "Payment cancelled" ],
    "payment_voided" => [ "payment_voided", "Payment voided" ],
    "payment_failed" => [ "payment_failed", "Payment needs attention" ]
  }.each do |later_state, (expected_status, label)|
    it "retains paid hours and an honest label when a later batch is #{later_state}" do
      source = entry
      receipt(source, "payment_issued", hours: 6)
      later_batch = create(:payroll_batch, start_date: batch.start_date.next_month, end_date: batch.end_date.next_month,
        cutoff_at: batch.cutoff_at + 1.month, finalized_at: batch.finalized_at + 1.month)
      receipt(source, later_state, hours: 2, line_key: "training", payroll_batch: later_batch)
      expect(status_for(source)).to include("status" => expected_status, "label" => label, "paid_hours" => 6.0)
    end
  end

  it "does not count already paid lines as held inside a mixed voided settlement" do
    source = entry
    receipt(source, "payment_issued", hours: 6)
    receipt(source, "payment_voided", hours: 2, line_key: "training")
    batch.payroll_batch_exclusions.create!(source_time_entry_id: source.id, source_user_id: employee.id,
      source_user_uuid: employee.payroll_integration_uuid, reason: "pending_approval",
      held_total_hours: 8, held_regular_hours: 8, held_overtime_hours: 0, snapshot: {})
    expect(status_for(source)).to include("status" => "payment_voided", "paid_hours" => 6.0, "held_hours" => 2.0)
  end

  it "does not resurrect an issued receipt after the same check is cancelled" do
    source = entry
    receipt(source, "payment_cancelled")
    PayrollEntryProcessingEvent.create!(batch.payroll_entry_processing_events.last.attributes.except("id", "created_at", "updated_at").merge(
      "event_id" => SecureRandom.uuid, "status" => "payment_issued", "occurred_at" => 1.minute.from_now))
    expect(status_for(source)).to include("status" => "payment_cancelled", "paid_hours" => 0.0)
  end

  it "ignores another person's filter and denies their individual and manager endpoints" do
    mine = entry
    other = create(:time_entry)
    receipt(other, "payment_issued")
    get "/api/v1/time_entries", params: { user_id: other.user_id }, headers: headers
    expect(response.parsed_body.fetch("time_entries").map { |row| row.fetch("id") }).to eq([ mine.id ])
    get "/api/v1/time_entries/#{other.id}", headers: headers
    expect(response).to have_http_status(:not_found)
    get "/api/v1/admin/users/#{employee.id}/periods", headers: headers
    expect(response).to have_http_status(:forbidden)
  end

  %w[paused enabled].each do |mode|
    it "reads paid status while #{mode} without any payroll, allocation, approval or lifecycle writes" do
      source = entry
      receipt(source, "payment_issued")
      previous = ENV["CONNECTED_PAYROLL_MODE"]
      ENV["CONNECTED_PAYROLL_MODE"] = mode
      writes = []
      recorder = ->(_name, _start, _finish, _id, payload) { writes << payload[:sql] if payload[:sql].match?(/\A\s*(INSERT|UPDATE|DELETE)\b/i) }
      ActiveSupport::Notifications.subscribed(recorder, "sql.active_record") do
        expect(status_for(source)).to include("status" => "payment_issued")
        get "/api/v1/time_entries", headers: headers
        expect(response).to have_http_status(:ok)
      end
      expect(writes).to be_empty
      expect(source.reload.approval_status).to eq("approved")
    ensure
      ENV["CONNECTED_PAYROLL_MODE"] = previous
    end
  end

  it "bulk-resolves only the authorized page with bounded queries as its size grows" do
    entries = Array.new(12) { |index| entry(work_date: Date.current - index.days) }
    entries.each { |source| receipt(source, "payment_prepared") }
    # Warm schema and auth caches before measuring uncached SQL.
    get "/api/v1/time_entries", params: { per_page: 1 }, headers: headers
    count_queries = lambda do |limit|
      sql = []
      recorder = ->(_name, _start, _finish, _id, payload) { sql << payload[:sql] unless payload[:name] == "SCHEMA" || payload[:cached] }
      ActiveRecord::Base.uncached do
        ActiveSupport::Notifications.subscribed(recorder, "sql.active_record") do
          get "/api/v1/time_entries", params: { per_page: limit }, headers: headers
        end
      end
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body.fetch("time_entries").size).to eq(limit)
      sql
    end
    one = count_queries.call(1)
    many = count_queries.call(12)
    RSpec.configuration.reporter.message("My Time uncached SQL: 1 entry=#{one.size}, 12 entries=#{many.size}")
    expect(many.size).to be <= one.size + 2
    expect(many.size).to be <= 35
    get "/api/v1/time_entries", params: { per_page: entries.size }, headers: headers
    second_id = response.parsed_body.fetch("time_entries").second.fetch("id")
    expect(Payroll::EmployeeEntryStatus).to receive(:new).with(entries: satisfy { |rows| rows.map(&:id) == [ second_id ] && rows.all? { |row| row.user_id == employee.id } }).and_call_original
    get "/api/v1/time_entries", params: { per_page: 1, page: 2 }, headers: headers
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body.fetch("time_entries").map { |row| row.fetch("id") }).to eq([ second_id ])
  end
end
