# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Employee time-entry payment visibility", type: :request do
  let(:employee) { create(:user, :employee) }
  let(:admin) { create(:user, :admin) }
  let(:category) { create(:time_category) }
  let(:headers) { { "Authorization" => "Bearer test_token_#{employee.id}" } }
  let(:batch) { create(:payroll_batch) }

  before do |example|
    next if example.metadata[:without_rollout]

    PayrollLockRollout.configure!(starts_on: Date.current.beginning_of_month, actor: "test", reason: "Synthetic tracking activation")
  end

  def entry(**attributes)
    create(:time_entry, user: employee, time_category: category, status: "completed",
      entry_method: "clock", clock_source: "legacy", approval_status: "approved", overtime_status: "none", **attributes)
  end

  def receipt(source, status, hours: source.hours, line_key: "work", payroll_batch: batch, source_kind: "current", **attributes)
    row = payroll_batch.payroll_batch_entries.create!(source_time_entry_id: source.id, source_user_id: source.user_id,
      source_user_uuid: source.user.payroll_integration_uuid, source_category_id: source.time_category_id,
      work_date: source.work_date, week_start: source.work_date.beginning_of_week(:sunday), source_kind: source_kind,
      line_key: line_key, total_hours: hours, regular_hours: hours, overtime_hours: 0, snapshot: {})
    return row if status.nil?

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

  %w[paused enabled].each do |mode|
    it "keeps mixed entry/batch committed history neutral while #{mode}", without_rollout: mode == "paused" do
      source = entry(work_date: Date.current.beginning_of_month - 1.day)
      receipt(source, "committed", payment_method: nil, payment_reference: nil)
      %w[cornerstone_payroll cornerstone_payroll_manual].each_with_index do |system, index|
        batch.payroll_batch_processing_events.create!(event_id: SecureRandom.uuid, status: "committed",
          external_system: system, external_pay_period_id: "test-history", occurred_at: Time.current + index.seconds)
      end
      previous = ENV["CONNECTED_PAYROLL_MODE"]
      ENV["CONNECTED_PAYROLL_MODE"] = mode
      lifecycle = Payroll::EntryLifecycleResolver.new(entries: [ source ]).call.fetch(source.id)
      expect(lifecycle).to include(status: "committed", paid_hours: 0.0)
      expect(lifecycle.fetch(:settlements).sole.fetch(:legacy_processing)).to be(false)
      expect(batch.processing_status.fetch(:external_system)).to eq("cornerstone_payroll_manual")
      expected = { "status" => "payment_history_unavailable", "label" => "Payment history unavailable", "paid_hours" => 0.0 }
      expect(status_for(source)).to include(expected)
      get "/api/v1/time_entries", headers: headers
      expect(response.parsed_body.fetch("time_entries").sole.fetch("payroll_status")).to include(expected)
      expect(source.reload.approval_status).to eq("approved")
    ensure
      ENV["CONNECTED_PAYROLL_MODE"] = previous
    end
  end

  [ nil, "imported" ].each do |state|
    it "keeps historical #{state || 'finalized'} time neutral without issued payment evidence" do
      source = entry(work_date: Date.current.beginning_of_month - 1.day)
      receipt(source, state)
      expect(status_for(source)).to include("status" => "payment_history_unavailable", "label" => "Payment history unavailable", "paid_hours" => 0.0)
    end
  end

  it "does not mislabel older manual time with no approval or settlements as unpaid" do
    source = entry(work_date: Date.current.beginning_of_month - 1.day, entry_method: "manual", approval_status: nil)
    before = source.attributes
    expect(status_for(source)).to include("status" => "payment_history_unavailable", "label" => "Payment history unavailable")
    expect(Payroll::EntryLifecycleResolver.new(entries: [ source ]).call.fetch(source.id).fetch(:status)).to eq("awaiting_approval")
    expect(source.reload.attributes).to eq(before)
  end

  it "keeps current manual time awaiting approval when payment tracking is active" do
    source = entry(entry_method: "manual", approval_status: nil)
    expect(status_for(source)).to include("status" => "awaiting_approval", "label" => "Not in payroll — awaiting approval")
    expect(source.reload.approval_status).to be_nil
  end

  it "uses neutral wording for unapproved hand-paid time before tracking setup", :without_rollout do
    source = entry(entry_method: "manual", approval_status: nil)
    expect(status_for(source)).to include("status" => "payment_history_unavailable", "label" => "Payment status not tracked yet")
    expect(source.reload.approval_status).to be_nil
  end

  %w[clocked_in on_break].each do |state|
    %w[enabled paused].each do |mode|
      it "labels an #{state} shift in progress while #{mode}" do
        source = entry(status: state, approval_status: nil, end_time: nil)
        previous = ENV["CONNECTED_PAYROLL_MODE"]
        ENV["CONNECTED_PAYROLL_MODE"] = mode
        expect(status_for(source)).to include("status" => "awaiting_approval", "label" => "Shift in progress", "paid_hours" => 0.0)
        expect(source.reload).to have_attributes(status: state, approval_status: nil)
      ensure
        ENV["CONNECTED_PAYROLL_MODE"] = previous
      end
    end
  end

  it "keeps a reported historical payment held until exact payment evidence exists" do
    source = entry
    Payroll::PaymentAttestationRecorder.new(actor: admin).attest!(entry: source,
      source_user_uuid: employee.payroll_integration_uuid, reason: "Private test evidence pending reconciliation")
    expect(status_for(source)).to eq("status" => "payment_attested_pending_evidence", "label" => "Payment reported — details pending", "paid_hours" => 0.0, "held_hours" => 8.0)
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

  describe "older hours carried onto a calendar payroll" do
    let(:older) { entry(work_date: Date.current.beginning_of_month - 16.days) }
    let(:admin_headers) { { "Authorization" => "Bearer test_token_#{admin.id}" } }

    def calendar!(payroll_batch = batch)
      create(:payroll_calendar_period, status: "finalized", payroll_batch: payroll_batch, finalized_at: Time.current)
    end

    def admin_status_for(source)
      get "/api/v1/time_entries/#{source.id}", headers: admin_headers
      expect(response).to have_http_status(:ok)
      response.parsed_body.fetch("time_entry").fetch("payroll_status")
    end

    it "reports the calendar payroll's real status to the worker and to admins, with no paycheck links" do
      receipt(older, "committed")
      calendar!

      expected = { "status" => "committed", "label" => "In payroll — not paid yet", "paid_hours" => 0.0, "held_hours" => 0.0 }
      expect(status_for(older)).to eq(expected)
      expect(admin_status_for(older)).to eq(expected)
    end

    it "keeps carried-over hours neutral while connected payroll is paused" do
      receipt(older, "committed")
      calendar!
      previous = ENV["CONNECTED_PAYROLL_MODE"]
      ENV["CONNECTED_PAYROLL_MODE"] = "paused"

      expect(status_for(older)).to include("status" => "payment_history_unavailable", "label" => "Payment history unavailable")
      expect(admin_status_for(older)).to include("status" => "payment_history_unavailable")
    ensure
      ENV["CONNECTED_PAYROLL_MODE"] = previous
    end

    it "keeps them neutral when any settlement comes from a batch outside the payroll calendar" do
      receipt(older, "committed", hours: 4, line_key: "calendar")
      calendar!
      receipt(older, "committed", hours: 4, line_key: "manual", payroll_batch: create(:payroll_batch, start_date: Date.new(2026, 8, 16), end_date: Date.new(2026, 8, 31)))

      expect(status_for(older)).to include("status" => "payment_history_unavailable", "label" => "Payment history unavailable")
    end

    it "keeps a calendar batch committed only by a manual batch record neutral" do
      receipt(older, nil)
      batch.payroll_batch_processing_events.create!(event_id: SecureRandom.uuid, status: "committed",
        external_system: "cornerstone_payroll_manual", external_pay_period_id: "test-history", occurred_at: Time.current)
      calendar!

      expect(status_for(older)).to include("status" => "payment_history_unavailable", "label" => "Payment history unavailable")
      expect(admin_status_for(older)).to include("status" => "payment_history_unavailable")
    end

    it "still shows a held older entry with no settlements as payment history unavailable, not held" do
      source = entry(work_date: Date.current.beginning_of_month - 16.days, approval_status: "pending")
      calendar!
      batch.payroll_batch_exclusions.create!(source_time_entry_id: source.id, source_user_id: employee.id,
        source_user_uuid: employee.payroll_integration_uuid, reason: "pending_approval",
        held_total_hours: 8, held_regular_hours: 8, held_overtime_hours: 0, snapshot: {})

      expect(status_for(source)).to include("status" => "payment_history_unavailable", "held_hours" => 8.0)
    end
  end

  it "does not invent payment history for uncovered entries inside the existing legacy fence" do
    boundary = Date.current.beginning_of_month
    PayrollLockRollout.configure!(starts_on: boundary, actor: "test", reason: "Synthetic historical test boundary")
    source = entry(work_date: boundary - 1.day)
    batch.payroll_batch_processing_events.create!(event_id: SecureRandom.uuid, status: "committed",
      external_system: "cornerstone_payroll_manual", external_pay_period_id: "test-history", occurred_at: Time.current)
    expect(status_for(source)).to include("status" => "payment_history_unavailable", "paid_hours" => 0.0)
  end

  it "uses neutral history for no-settlement entries while paused or before rollout setup", :without_rollout do
    source = entry
    previous = ENV["CONNECTED_PAYROLL_MODE"]
    ENV["CONNECTED_PAYROLL_MODE"] = "paused"
    expect(status_for(source)).to include("status" => "payment_history_unavailable", "label" => "Approved — payment status not tracked yet")
    ENV["CONNECTED_PAYROLL_MODE"] = "enabled"
    expect(status_for(source)).to include("status" => "payment_history_unavailable", "label" => "Approved — payment status not tracked yet")
  ensure
    ENV["CONNECTED_PAYROLL_MODE"] = previous
  end

  it "keeps older uncovered entries neutral even without a manual batch" do
    source = entry(work_date: Date.current.beginning_of_month - 1.day)
    expect(status_for(source)).to include("status" => "payment_history_unavailable", "label" => "Payment history unavailable")
  end

  it "describes historical reports calmly without exposing or implying exact payment evidence" do
    source = entry(work_date: Date.current.beginning_of_month - 1.day)
    batch.payroll_batch_processing_events.create!(event_id: SecureRandom.uuid, status: "committed",
      external_system: "cornerstone_payroll_manual", occurred_at: Time.current)
    Payroll::PaymentAttestationRecorder.new(actor: admin).attest!(entry: source,
      source_user_uuid: employee.payroll_integration_uuid, reason: "Private historical payment report")
    expect(status_for(source)).to include("status" => "payment_attested_pending_evidence", "label" => "Historical payment reported — details unavailable", "paid_hours" => 0.0, "held_hours" => 8.0)
    expect(response.body).not_to include("Private historical", "payment_reference", "attested_at")
  end

  it "does not describe paid source hours as unpaid after a negative correction" do
    source = entry(hours: 6)
    receipt(source, "payment_issued", hours: 8, occurred_at: 1.minute.ago)
    later = create(:payroll_batch, start_date: batch.start_date.next_month, end_date: batch.end_date.next_month, cutoff_at: batch.cutoff_at + 1.month, finalized_at: batch.finalized_at + 1.month)
    receipt(source, "committed", hours: -2, line_key: "correction", source_kind: "correction", payroll_batch: later)
    expect(status_for(source)).to include("status" => "committed", "label" => "Paid hours recorded — payroll update pending", "paid_hours" => 8.0)
  end

  it "describes an accounting correction separately from payment, with or without original paid evidence" do
    source = entry(hours: 6)
    correction = create(:payroll_batch, start_date: batch.start_date.next_month, end_date: batch.end_date.next_month, cutoff_at: batch.cutoff_at + 1.month, finalized_at: batch.finalized_at + 1.month)
    metadata = { "accounting_only" => true, "correction_disposition_id" => "9", "original_pay_period_id" => "10", "original_payroll_item_id" => "11",
      "corrective_pay_period_id" => "44", "corrective_payroll_item_id" => "55" }
    receipt(source, "committed", hours: -2, source_kind: "correction", payroll_batch: correction,
      payment_method: nil, payment_reference: nil, external_pay_period_id: "44", external_payroll_item_id: "55", metadata: metadata)
    expect(status_for(source)).to include("label" => "Payroll correction recorded — no new payment", "paid_hours" => 0.0)
    receipt(source, "payment_issued", hours: 8, occurred_at: 1.minute.ago)
    expect(status_for(source)).to include("label" => "Payroll correction recorded — no new payment", "paid_hours" => 8.0)
  end

  it "explains pending weekly overtime holds as needing approval" do
    source = entry(overtime_status: "pending")
    allow(Payroll::WeeklyOvertimeReview).to receive(:call).and_return(source.id => true)
    batch.payroll_batch_exclusions.create!(source_time_entry_id: source.id, source_user_id: employee.id,
      source_user_uuid: employee.payroll_integration_uuid, reason: "pending_overtime",
      held_total_hours: 8, held_regular_hours: 0, held_overtime_hours: 8, snapshot: {})
    expect(status_for(source)).to include("status" => "held", "label" => "On hold — needs manager approval", "held_hours" => 8.0)
  end

  it "does not retain held quantities after time is denied" do
    source = entry(approval_status: "denied")
    batch.payroll_batch_exclusions.create!(source_time_entry_id: source.id, source_user_id: employee.id,
      source_user_uuid: employee.payroll_integration_uuid, reason: "pending_approval",
      held_total_hours: 8, held_regular_hours: 8, held_overtime_hours: 0, snapshot: {})
    expect(status_for(source)).to include("status" => "not_payable", "label" => "Not in payroll — time denied", "held_hours" => 0.0)
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
    expect(Payroll::EmployeeEntryStatus).to receive(:new).with(entries: satisfy { |rows| rows.map(&:id) == [ second_id ] && rows.all? { |row| row.user_id == employee.id } }, viewer: employee).and_call_original
    get "/api/v1/time_entries", params: { per_page: 1, page: 2 }, headers: headers
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body.fetch("time_entries").map { |row| row.fetch("id") }).to eq([ second_id ])
  end
end
