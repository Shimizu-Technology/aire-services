# frozen_string_literal: true

require "rails_helper"
require_relative "../../../support/payroll_clock_helpers"

RSpec.describe "Payroll periods", type: :request do
  include ActiveSupport::Testing::TimeHelpers
  include PayrollClockHelpers

  let(:zone) { ActiveSupport::TimeZone["Pacific/Guam"] }
  let(:owner) { create(:user, :owner) }
  let(:admin) { create(:user, :admin, first_name: "Chels") }
  let(:category) { create(:time_category) }
  let(:worker) { create(:user, :employee) }
  let(:now) { zone.local(2026, 11, 11, 12) }

  around { |example| travel_to(now) { example.run } }

  def headers_for(user)
    { "Authorization" => "Bearer test_token_#{user.id}" }
  end

  def period(start_date, **attributes)
    create(:payroll_calendar_period, payroll_calendar_for(start_date).merge(attributes))
  end

  # A period AIRE locked, with what Cornerstone has reported back since.
  def locked_period(start_date, processing: [], summary: { employee_count: 30, total_hours: 1962.4, regular_hours: 1950.0, overtime_hours: 12.4 })
    dates = payroll_calendar_for(start_date)
    batch = PayrollBatch.create!(public_id: "AIRE-PAY-#{start_date}", start_date: dates[:start_date], end_date: dates[:end_date],
                                 cutoff_at: dates[:cutoff_at], finalized_at: dates[:cutoff_at] + 1.minute, checksum: "a" * 64, summary: summary)
    processing.each_with_index do |status, index|
      PayrollBatchProcessingEvent.create!(payroll_batch: batch, event_id: "#{start_date}-#{status}", status: status,
                                          external_system: "cornerstone_payroll", occurred_at: dates[:cutoff_at] + (index + 1).hours)
    end
    period(start_date, status: "finalized", payroll_batch: batch, finalized_at: batch.finalized_at)
  end

  def outbox(calendar_period, status:, occurred_at:, **attributes)
    PayrollOutboxEvent.create!(payroll_calendar_period: calendar_period, event_type: "payroll_batch.finalized",
                               occurred_at: occurred_at, delivery_status: status, **attributes)
  end

  def periods
    get "/api/v1/payroll_periods", headers: headers_for(admin)
    expect(response).to have_http_status(:ok)
    response.parsed_body
  end

  def show(start_date, user: admin)
    get "/api/v1/payroll_periods/#{start_date}", headers: headers_for(user)
    response.parsed_body
  end

  describe "handoff_state" do
    before do
      period(Date.new(2026, 8, 1), lock_mode: "manual", cutoff_enforcement_starts_on: Date.new(2026, 10, 16))
      locked_period(Date.new(2026, 8, 16), processing: %w[imported committed payment_issued])
      locked_period(Date.new(2026, 9, 1), processing: %w[imported committed])
      locked_period(Date.new(2026, 9, 16), processing: %w[imported])
      outbox(locked_period(Date.new(2026, 10, 1)), status: "failed", occurred_at: zone.local(2026, 10, 18, 17, 1),
             delivery_attempts: 4, last_response_status: 422, last_error: "Cornerstone returned HTTP 422")
      period(Date.new(2026, 11, 1))
    end

    it "gives each period its step, the glossary label, and marks the labels provisional" do
      body = periods

      expect(body.fetch("periods").map { |row| [ row["start_date"], row["handoff_state"], row["label"] ] }).to eq([
        [ "2026-11-01", "open", "Open" ],
        [ "2026-10-01", "locked", "Locked for payroll" ],
        [ "2026-09-16", "received", "Received by Payroll" ],
        [ "2026-09-01", "in_run", "In a payroll run" ],
        [ "2026-08-16", "paid", "Paid" ],
        [ "2026-08-01", "before_locking", "Before locking" ]
      ])
      expect(body.fetch("periods")).to all(include("label_provisional" => true))
      expect(body.fetch("labels")).to include("provisional" => true, "note" => a_string_including("Chels"))
      expect(body.fetch("current_start_date")).to eq("2026-11-01")
    end

    it "shows the steps done so far" do
      in_run = periods.fetch("periods").find { |row| row["start_date"] == "2026-09-01" }

      expect(in_run.fetch("steps").map { |step| [ step["key"], step["state"] ] }).to eq([
        %w[open done], %w[locked done], %w[received done], %w[in_run current], %w[paid upcoming]
      ])
      expect(in_run.fetch("payroll_status")).to include("status" => "committed")
      paid = periods.fetch("periods").find { |row| row["start_date"] == "2026-08-16" }
      expect(paid.fetch("steps").map { |step| step["state"] }).to all(eq("done"))
      before = periods.fetch("periods").find { |row| row["start_date"] == "2026-08-01" }
      expect(before.fetch("steps")).to eq([])
    end

    it "keeps a locked period that Payroll hasn't received at locked, with the refused delivery" do
      locked = show("2026-10-01").fetch("period")

      expect(locked).to include("handoff_state" => "locked", "status" => "finalized", "payroll_batch_id" => "AIRE-PAY-2026-10-01",
                                "payroll_status" => nil, "hours_source" => "locked", "people" => 30, "locked_hours" => 1962.4)
      expect(locked.fetch("delivery")).to include("status" => "failed", "stuck" => true, "attempts" => 4,
                                                  "last_response_status" => 422, "last_error" => "Cornerstone returned HTTP 422")
    end

    it "counts a payment problem as still in the payroll run" do
      locked_period(Date.new(2026, 7, 16), processing: %w[imported committed payment_failed])

      failed = show("2026-07-16").fetch("period")

      expect(failed).to include("handoff_state" => "in_run")
      expect(failed.fetch("payroll_status")).to include("status" => "payment_failed")
    end
  end

  it "keeps a published period with no batch open, with live hours" do
    period(Date.new(2026, 11, 1))
    start = zone.local(2026, 11, 2, 8)
    create(:time_entry, user: worker, time_category: category, work_date: Date.new(2026, 11, 2), entry_method: "clock", status: "completed",
           start_time: start, end_time: start + 8.hours, clock_in_at: start, clock_out_at: start + 8.hours, approval_status: "approved")
    create(:time_entry, user: worker, time_category: category, work_date: Date.new(2026, 11, 3), entry_method: "clock", status: "completed",
           start_time: start + 1.day, end_time: start + 1.day + 6.hours, approval_status: "pending")

    open = show("2026-11-01").fetch("period")

    expect(open).to include("handoff_state" => "open", "status" => "scheduled", "cutoff_state" => "upcoming", "payroll_batch_id" => nil,
                            "delivery" => nil, "payroll_status" => nil, "locked_at" => nil, "hours_source" => "live",
                            "people" => 1, "approved_hours" => 8.0, "waiting_hours" => 6.0, "waiting_count" => 1)
    expect(open.fetch("steps").first).to include("key" => "open", "state" => "current")
  end

  it "keeps a period whose lock failed open, flagged for attention" do
    period(Date.new(2026, 10, 16), status: "failed")

    expect(show("2026-10-16").fetch("period")).to include("handoff_state" => "open", "status" => "failed", "cutoff_state" => "attention_required")
  end

  it "keeps a scheduled period from before the lock rollout as before locking" do
    PayrollLockRollout.configure!(starts_on: "2026-10-16", actor: "test operator", reason: "Approved test rollout")
    period(Date.new(2026, 10, 1))

    expect(show("2026-10-01").fetch("period")).to include("handoff_state" => "before_locking", "label" => "Before locking")
  end

  describe "lock control" do
    let(:published) do
      policy = payroll_calendar_for(Date.new(2026, 11, 1))
      period(Date.new(2026, 11, 1), cutoff_at: zone.local(2026, 11, 17, 17), cutoff_source: "override", policy_cutoff_at: policy[:cutoff_at],
             next_finalization_attempt_at: zone.local(2026, 11, 17, 17),
             cutoff_override: { "action" => "change", "reason" => "Payday moved for the holiday", "set_at" => now.iso8601,
                                "set_by" => { "name" => "Chels", "system" => "cornerstone_payroll" },
                                "previous_cutoff_at" => policy[:cutoff_at].iso8601 })
    end

    it "carries the override and a change waiting on Cornerstone, as the lock card does" do
      AuditLog.record!(action: Payroll::LockControl::REQUESTED, actor: admin, auditable: published, event_category: "payroll",
        metadata: { requested_action: "lock_now", cornerstone_schedule_version: 2, cornerstone_cutoff_at: zone.local(2026, 11, 16, 9).iso8601 })

      body = show("2026-11-01").fetch("period")

      expect(body).to include("cutoff_source" => "override", "cutoff_at" => "2026-11-17T17:00:00+10:00")
      expect(body.fetch("override")).to include("action" => "change", "reason" => "Payday moved for the holiday", "set_by_name" => "Chels",
                                                "policy_cutoff_at" => "2026-11-18T17:00:00+10:00")
      expect(body.fetch("lock_change")).to include("state" => "pending", "action" => "lock_now")
      get "/api/v1/payroll_cutoff", headers: headers_for(admin)
      expect(response.parsed_body.dig("lock_control", "pending_change")).to eq(body.fetch("lock_change"))
    end
  end

  it "points to the neighbouring periods and refuses dates that aren't published or aren't period starts" do
    period(Date.new(2026, 10, 16))
    period(Date.new(2026, 11, 1))

    expect(show("2026-11-01")).to include("previous_start_date" => "2026-10-16", "next_start_date" => nil)

    expect(show("2026-12-01")).to include("code" => "not_published")
    expect(response).to have_http_status(:not_found)
    show("2026-11-03")
    expect(response).to have_http_status(:unprocessable_entity)
    show("2026-02-30")
    expect(response).to have_http_status(:unprocessable_entity)
  end

  it "is for owners and admins only" do
    period(Date.new(2026, 11, 1))

    [ owner, admin ].each do |user|
      get "/api/v1/payroll_periods", headers: headers_for(user)
      expect(response).to have_http_status(:ok)
      show("2026-11-01", user: user)
      expect(response).to have_http_status(:ok)
    end
    [ create(:user, :manager), worker ].each do |user|
      get "/api/v1/payroll_periods", headers: headers_for(user)
      expect(response).to have_http_status(:forbidden)
      show("2026-11-01", user: user)
      expect(response).to have_http_status(:forbidden)
    end
  end
end
