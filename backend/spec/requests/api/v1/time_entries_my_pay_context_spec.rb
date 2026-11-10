# frozen_string_literal: true

require "rails_helper"
require_relative "../../../support/database_clock_helpers"

RSpec.describe "My Time paycheck links and cutoff explanations", type: :request do
  include DatabaseClockHelpers
  include ActiveSupport::Testing::TimeHelpers

  # The next-payroll note reads the first scheduled cutoff after now, and work
  # dates and the rollout start follow Date.current. Pin both the Rails and
  # database clocks before any setup so the fixed November/December calendar
  # below stays ahead of "now" on any run date. The "Sep 18 cutoff" in the
  # notes is the payroll_batch factory's fixed cutoff_at, not today's date.
  around { |example| with_shifted_database_clock(Time.find_zone!("Pacific/Guam").local(2026, 11, 10, 9)) { example.run } }

  let(:guam) { ActiveSupport::TimeZone["Pacific/Guam"] }
  let(:employee) { create(:user, :employee) }
  let(:admin) { create(:user, :admin) }
  let(:category) { create(:time_category) }
  let(:headers) { { "Authorization" => "Bearer test_token_#{employee.id}" } }
  let(:batch) { create(:payroll_batch) }

  before do
    PayrollLockRollout.configure!(starts_on: Date.current.beginning_of_month, actor: "test", reason: "Synthetic tracking activation")
    Setting.set("my_pay_enabled_user_ids", employee.id.to_s)
  end

  def entry(**attributes)
    create(:time_entry, user: employee, time_category: category, status: "completed",
      entry_method: "clock", clock_source: "legacy", approval_status: "approved", overtime_status: "none", **attributes)
  end

  def receipt(source, status, item_id: "41")
    row = batch.payroll_batch_entries.create!(source_time_entry_id: source.id, source_user_id: source.user_id,
      source_user_uuid: source.user.payroll_integration_uuid, source_category_id: source.time_category_id,
      work_date: source.work_date, week_start: source.work_date.beginning_of_week(:sunday), source_kind: "current",
      line_key: "work", total_hours: source.hours, regular_hours: source.hours, overtime_hours: 0, snapshot: {})
    PayrollEntryProcessingEvent.create!(payroll_batch: batch, event_id: SecureRandom.uuid,
      source_time_entry_id: source.id, source_user_uuid: row.source_user_uuid,
      contract_version: "2.0", source_line_key: row.line_key, source_kind: row.source_kind,
      total_hours: source.hours, regular_hours: source.hours, overtime_hours: 0, status: status,
      external_system: "cornerstone_payroll", external_pay_period_id: "test-period", external_payroll_item_id: item_id,
      payment_method: "check", payment_reference: "PRIVATE-TEST-REFERENCE", occurred_at: Time.current)
  end

  def exclude(source, reason)
    batch.payroll_batch_exclusions.create!(source_time_entry_id: source.id, source_user_id: employee.id,
      source_user_uuid: employee.payroll_integration_uuid, reason: reason,
      held_total_hours: source.hours, held_regular_hours: source.hours, held_overtime_hours: 0, snapshot: {})
  end

  def next_period!
    create(:payroll_calendar_period, start_date: "2026-11-16", end_date: "2026-11-30", pay_date: "2026-12-06",
      cutoff_at: guam.local(2026, 11, 29, 17))
  end

  def status_for(source, auth = headers)
    get "/api/v1/time_entries/#{source.id}", headers: auth
    expect(response).to have_http_status(:ok)
    response.parsed_body.fetch("time_entry").fetch("payroll_status")
  end

  it "links a paid entry to the paycheck that paid it, without private payment evidence" do
    source = entry
    receipt(source, "payment_issued")
    create(:payroll_calendar_period, start_date: "2026-11-01", end_date: "2026-11-15", pay_date: "2026-11-22",
      cutoff_at: guam.local(2026, 11, 15, 17), status: "finalized", payroll_batch: batch, finalized_at: Time.current)

    expect(status_for(source)).to eq("status" => "payment_issued", "label" => "Paid", "paid_hours" => 8.0, "held_hours" => 0.0,
      "paychecks" => [ { "statement_id" => "41", "pay_date" => "2026-11-22" } ])
    get "/api/v1/time_entries", headers: headers
    expect(response.parsed_body.fetch("time_entries").sole.dig("payroll_status", "paychecks")).to eq([ { "statement_id" => "41", "pay_date" => "2026-11-22" } ])
    expect(response.body).not_to include("PRIVATE-TEST-REFERENCE", "test-period", "settlements", "payment_reference")
  end

  it "links older hours carried onto a current calendar payroll instead of calling their history unavailable" do
    source = entry(work_date: Date.current.beginning_of_month - 16.days)
    receipt(source, "committed")
    create(:payroll_calendar_period, start_date: "2026-11-01", end_date: "2026-11-15", pay_date: "2026-11-22",
      cutoff_at: guam.local(2026, 11, 15, 17), status: "finalized", payroll_batch: batch, finalized_at: Time.current)

    expect(status_for(source)).to eq("status" => "committed", "label" => "In payroll — not paid yet", "paid_hours" => 0.0, "held_hours" => 0.0,
      "paychecks" => [ { "statement_id" => "41", "pay_date" => "2026-11-22" } ])
  end

  it "keeps older committed hours without a current calendar payroll neutral" do
    source = entry(work_date: Date.current.beginning_of_month - 16.days)
    receipt(source, "committed")

    expect(status_for(source)).to eq("status" => "payment_history_unavailable", "label" => "Payment history unavailable", "paid_hours" => 0.0, "held_hours" => 0.0)
  end

  it "adds nothing when My Pay is not enabled for the worker" do
    Setting.set("my_pay_enabled_user_ids", "")
    source = entry
    receipt(source, "payment_issued")
    expect(status_for(source)).to eq("status" => "payment_issued", "label" => "Paid", "paid_hours" => 8.0, "held_hours" => 0.0)
    expect(response.body).not_to include("test-item", "\"41\"")
  end

  it "never adds another worker's paycheck to an admin's view of their entries" do
    Setting.set("my_pay_enabled_user_ids", "#{employee.id},#{admin.id}")
    source = entry
    receipt(source, "payment_issued")
    expect(status_for(source, { "Authorization" => "Bearer test_token_#{admin.id}" })).not_to have_key("paychecks")
  end

  it "skips accounting-only or untrusted statement references" do
    source = entry
    receipt(source, "payment_issued", item_id: "item-abc")
    expect(status_for(source)).not_to have_key("paychecks")
  end

  it "explains hours approved after the cutoff with the expected pay date" do
    next_period!
    source = entry
    exclude(source, "approved_after_cutoff")
    expect(status_for(source)).to eq("status" => "held", "label" => "On hold — awaiting payroll", "paid_hours" => 0.0, "held_hours" => 8.0,
      "note" => "Approved after the Sep 18 cutoff — moves to the next payroll (expected Dec 6)")
  end

  it "uses a routed settlement case's target payroll date" do
    next_period!
    target = create(:payroll_calendar_period, start_date: "2026-12-01", end_date: "2026-12-15", pay_date: "2026-12-20",
      cutoff_at: guam.local(2026, 12, 13, 17))
    source = entry
    exclusion = exclude(source, "created_after_cutoff")
    create(:payroll_settlement_case, origin_payroll_batch: batch, origin_payroll_batch_exclusion: exclusion,
      source_time_entry_id: source.id, source_user_id: employee.id, source_user_uuid: employee.payroll_integration_uuid,
      origin_reason: "created_after_cutoff", destination_kind: "regular", status: "scheduled",
      target_payroll_calendar_period: target, target_external_pay_period_id: target.external_pay_period_id)
    expect(status_for(source)["note"]).to eq("Added after the Sep 18 cutoff — moves to the next payroll (expected Dec 20)")
  end

  it "explains hours still waiting for approval at the cutoff" do
    source = entry(approval_status: "pending")
    exclude(source, "pending_approval")
    expect(status_for(source)).to include("label" => "On hold — needs manager approval",
      "note" => "Still waiting for approval at the Sep 18 cutoff — it will be paid on a later payroll once approved")
  end

  it "does not explain ordinary approved time before any cutoff" do
    next_period!
    expect(status_for(entry)).not_to have_key("note")
  end
end
