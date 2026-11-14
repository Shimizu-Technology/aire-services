# frozen_string_literal: true

require "rails_helper"
require_relative "../../../support/payroll_clock_helpers"

RSpec.describe "Attention", type: :request do
  include ActiveSupport::Testing::TimeHelpers
  include PayrollClockHelpers

  let(:zone) { ActiveSupport::TimeZone["Pacific/Guam"] }
  let(:owner) { create(:user, :owner) }
  let(:admin) { create(:user, :admin, first_name: "Chels") }
  let(:manager) { create(:user, :manager, first_name: "Roke") }
  let(:employee) { create(:user, :employee, first_name: "Ana") }
  let(:category) { create(:time_category) }
  let(:caleb) { create(:user, :employee, first_name: "Caleb", last_name: "Perez") }
  let(:grace) { create(:user, :employee, first_name: "Grace", last_name: "Torres") }

  # Just after midnight Guam, Wed Nov 11 (14:20 UTC on Nov 10): a UTC work
  # date would still read Nov 10 and miss yesterday's forgotten clock-out.
  let(:now) { zone.local(2026, 11, 11, 0, 20) }

  around { |example| travel_to(now) { example.run } }

  def headers_for(user)
    { "Authorization" => "Bearer test_token_#{user.id}" }
  end

  def attention(user = admin)
    get "/api/v1/attention", headers: headers_for(user)
    expect(response).to have_http_status(:ok)
    response.parsed_body
  end

  def open_clock(user, at:, status: "clocked_in")
    create(:time_entry, user: user, time_category: category, work_date: at.to_date, entry_method: "clock",
           status: status, start_time: at, clock_in_at: at, end_time: nil, clock_out_at: nil, hours: 0)
  end

  def shift(user, date:, hours: 8, **attributes)
    start = zone.local(date.year, date.month, date.day, 8)
    create(:time_entry, { user: user, time_category: category, work_date: date, entry_method: "clock", status: "completed",
                          start_time: start, end_time: start + hours.hours, clock_in_at: start, clock_out_at: start + hours.hours,
                          approval_status: "approved", overtime_status: "none" }.merge(attributes))
  end

  def publish_november!
    create(:payroll_calendar_period, payroll_calendar_for(Date.new(2026, 11, 1)))
  end

  it "does not count legacy denied time with orphan pending overtime in Today or the live period" do
    publish_november!
    entry = shift(caleb, date: Date.new(2026, 11, 9), approval_status: "denied")
    entry.update_columns(overtime_status: "pending")
    body = attention
    expect(body.dig("approvals", "count")).to eq(0)
    expect(body.fetch("items").pluck("type")).not_to include("approvals_waiting", "overtime_waiting")
    expect(body.dig("period", "waiting_count")).to eq(0)
    expect(body.dig("period", "waiting_hours")).to eq(0)
    get "/api/v1/time_entries/pending_approvals", headers: headers_for(admin)
    expect(response.parsed_body.fetch("count")).to eq(0)
  end

  describe "open clocks" do
    it "flags yesterday's clock the minute the Guam day changes, and leaves a just-started clock alone" do
      before_midnight = open_clock(caleb, at: zone.local(2026, 11, 10, 23, 50))
      open_clock(grace, at: zone.local(2026, 11, 11, 0, 5))

      items = attention.fetch("items")

      expect(items.map { |item| item["type"] }).to eq([ "open_clock_earlier_day" ])
      expect(items.first).to include("entry_id" => before_midnight.id, "work_date" => "2026-11-10", "tone" => "needs_fix",
                                     "clock_in_at" => "2026-11-10T23:50:00+10:00", "hours_so_far" => 0.5)
      expect(items.first.dig("user", "full_name")).to eq("Caleb Perez")
    end

    it "lists earlier-day clocks oldest first, then today's clocks over 12 hours, longest first" do
      travel_to(zone.local(2026, 11, 11, 19, 40))
      newer = open_clock(caleb, at: zone.local(2026, 11, 10, 7, 2))
      older = open_clock(create(:user, :employee), at: zone.local(2026, 11, 9, 22), status: "on_break")
      long = open_clock(grace, at: zone.local(2026, 11, 11, 7, 16))
      longer = open_clock(create(:user, :employee), at: zone.local(2026, 11, 11, 6, 0))
      open_clock(create(:user, :employee), at: zone.local(2026, 11, 11, 8, 0)) # 11.7h: not yet

      items = attention.fetch("items")

      expect(items.map { |item| [ item["type"], item["entry_id"] ] }).to eq([
        [ "open_clock_earlier_day", older.id ], [ "open_clock_earlier_day", newer.id ],
        [ "long_clock_today", longer.id ], [ "long_clock_today", long.id ]
      ])
      expect(items.find { |item| item["entry_id"] == long.id }).to include("tone" => "waiting", "hours_so_far" => 12.4)
    end
  end

  it "orders the whole list: clocks, approvals, overtime, categories, payroll, leave, PINs, stub requests" do
    publish_november!
    open_clock(caleb, at: zone.local(2026, 11, 10, 7, 2))
    shift(grace, date: Date.new(2026, 11, 9), approval_status: "pending")
    shift(grace, date: Date.new(2026, 11, 6), overtime_status: "pending")
    shift(employee, date: Date.new(2026, 11, 5)).update_columns(time_category_id: nil)
    PayrollCalendarPeriod.first.update!(status: "failed")
    create(:leave_request, user: employee, start_date: Date.new(2026, 11, 13), end_date: Date.new(2026, 11, 13), leave_type: "sick")
    create(:leave_request, user: grace, start_date: Date.new(2026, 11, 12), end_date: Date.new(2026, 11, 12), leave_type: "sick")
    create(:user, :employee, first_name: "Kai").update_columns(kiosk_locked_until: now + 20.minutes)
    PayDocumentRequest.create!(user: employee, source: "kiosk", scope: "latest", recipient_kind: "on_file")

    body = attention(admin)

    expect(body.fetch("items").map { |item| item["type"] }).to eq(%w[
      open_clock_earlier_day approvals_waiting overtime_waiting missing_category payroll_problem
      leave_waiting kiosk_pin_locked pay_stub_requests
    ])
    expect(body.fetch("count")).to eq(8)
    leave = body.fetch("items").find { |item| item["type"] == "leave_waiting" }
    expect(leave).to include("count" => 2)
    expect(leave.dig("next", "user", "id")).to eq(grace.id)
    expect(body.fetch("items").find { |item| item["type"] == "payroll_problem" }).to include("problem" => "lock_failed")
  end

  it "counts shifts with no category in the current period unless the person has one category to fall back on" do
    publish_november!
    sole = create(:user, :employee).tap { |user| user.user_time_categories.create!(time_category: category) }
    blocking = shift(employee, date: Date.new(2026, 11, 5)).tap { |entry| entry.update_columns(time_category_id: nil) }
    shift(sole, date: Date.new(2026, 11, 5)).update_columns(time_category_id: nil)
    shift(employee, date: Date.new(2026, 10, 30)).update_columns(time_category_id: nil) # last period
    shift(employee, date: Date.new(2026, 11, 6), approval_status: "denied").update_columns(time_category_id: nil)

    item = attention(manager).fetch("items").find { |row| row["type"] == "missing_category" }

    expect(item).to include("count" => 1, "entry_ids" => [ blocking.id ], "tone" => "needs_fix")
    expect(item.fetch("period")).to eq("start_date" => "2026-11-01", "end_date" => "2026-11-15")
  end

  it "totals waiting overtime with the inbox's weekly projection" do
    (2..6).each { |day| shift(grace, date: Date.new(2026, 11, day)) }
    shift(grace, date: Date.new(2026, 11, 7), overtime_status: "pending")

    item = attention.fetch("items").find { |row| row["type"] == "overtime_waiting" }

    expect(item).to include("count" => 1, "hours" => 8.0, "hours_complete" => true, "unprojected_count" => 0)
    expect(item.fetch("people")).to contain_exactly(a_hash_including("id" => grace.id, "hours" => 8.0, "week_starts" => [ "2026-11-01" ]))
  end

  it "projects hours for whole people, oldest first, up to its budget, and still counts everyone" do
    stub_const("AttentionQuery::PROJECTED_OVERTIME_LIMIT", 2)
    (1..6).each { |day| shift(grace, date: Date.new(2026, 11, day), overtime_status: day == 6 ? "pending" : "none") }
    shift(caleb, date: Date.new(2026, 10, 26), overtime_status: "pending")
    shift(employee, date: Date.new(2026, 11, 9), overtime_status: "pending")
    shift(employee, date: Date.new(2026, 11, 10), overtime_status: "pending")

    body = attention
    item = body.fetch("items").find { |row| row["type"] == "overtime_waiting" }

    expect(item).to include("count" => 4, "hours" => nil, "hours_complete" => false, "unprojected_count" => 2)
    expect(item.fetch("count")).to eq(body.dig("approvals", "by_kind", "overtime"))
    expect(item.fetch("people").map { |row| [ row["id"], row["hours"], row["entry_count"], row["week_starts"] ] }).to eq([
      [ grace.id, 8.0, 1, [ "2026-11-01" ] ],
      [ caleb.id, 0.0, 1, [ "2026-10-25" ] ],
      [ employee.id, nil, 2, [ "2026-11-08" ] ]
    ])
  end

  it "stamps generated_at in Guam time even though the app runs in UTC" do
    expect(Time.zone.name).to eq("UTC")

    body = attention

    expect(body.fetch("generated_at")).to eq("2026-11-11T00:20:00+10:00")
  end

  it "reads all clear when nothing needs anyone" do
    body = attention(owner)

    expect(body).to include("count" => 0, "items" => [])
    expect(body.fetch("approvals")).to include("count" => 0, "total_hours" => 0.0)
  end

  describe "counts" do
    let(:group_member) { create(:user, :employee) }

    before do
      publish_november!
      shift(grace, date: Date.new(2026, 11, 2), approval_status: "pending")
      shift(grace, date: Date.new(2026, 11, 3), approval_status: "pending", overtime_status: "pending")
      shift(group_member, date: Date.new(2026, 11, 4), overtime_status: "pending")
      shift(group_member, date: Date.new(2026, 11, 5), approval_status: "pending", entry_method: "manual", clock_in_at: nil, clock_out_at: nil)
      shift(caleb, date: Date.new(2026, 10, 28), approval_status: "pending") # last period, still waiting
      shift(caleb, date: Date.new(2026, 11, 6), approval_status: "denied")
      shift(caleb, date: Date.new(2026, 11, 9))
      shift(manager, date: Date.new(2026, 11, 9), approval_status: "pending")
    end

    it "equals the Approvals badge (pending_approvals with no filters) for every supervisor" do
      [ owner, admin, manager ].each do |user|
        get "/api/v1/time_entries/pending_approvals", params: { page: 1, per_page: 1 }, headers: headers_for(user)
        summary = response.parsed_body.fetch("summary")

        approvals = attention(user).fetch("approvals")

        expect(approvals.fetch("count")).to eq(summary.fetch("entry_count"))
        expect(approvals.fetch("count")).to eq(6)
        expect(approvals.fetch("total_hours")).to eq(summary.fetch("total_hours"))
        expect(approvals.fetch("oldest_work_date")).to eq(summary.fetch("oldest_work_date"))
        expect(approvals.fetch("by_kind")).to eq(
          "time" => summary.fetch("pending_time_entry_count"), "overtime" => summary.fetch("pending_overtime_count"),
          "added" => summary.fetch("manual_count"), "clocked" => summary.fetch("clock_count")
        )
      end
    end

    it "equals the inbox filtered to the current pay period" do
      get "/api/v1/time_entries/pending_approvals", params: { per_page: 1, start_date: "2026-11-01", end_date: "2026-11-15" },
                                                     headers: headers_for(admin)
      summary = response.parsed_body.fetch("summary")

      period = attention(admin).fetch("period")

      expect(period).to include("published" => true, "start_date" => "2026-11-01", "end_date" => "2026-11-15",
                                "handoff_state" => "open", "label" => "Open", "label_provisional" => true)
      expect(period.fetch("waiting_count")).to eq(summary.fetch("entry_count"))
      expect(period.fetch("waiting_hours")).to eq(summary.fetch("total_hours"))
      expect(period.fetch("approved_hours")).to eq(8.0) # Caleb's approved Nov 9 shift; denied time is neither
      expect(period.fetch("people")).to eq(4)
    end

    it "matches the overtime count to the inbox" do
      overtime = attention(admin).fetch("items").find { |item| item["type"] == "overtime_waiting" }

      expect(overtime.fetch("count")).to eq(2)
      expect(overtime.fetch("people").map { |row| row["id"] }).to contain_exactly(grace.id, group_member.id)
    end
  end

  describe "payroll problems" do
    it "shows a paused connection to owners and admins" do
      previous = ENV["CONNECTED_PAYROLL_MODE"]
      ENV["CONNECTED_PAYROLL_MODE"] = "paused"

      body = attention(owner)

      expect(body.fetch("items")).to contain_exactly(
        a_hash_including("type" => "payroll_problem", "problem" => "connection_paused", "tone" => "needs_fix", "message" => "Connected payroll is paused")
      )
      expect(body.fetch("connected_payroll")).to include("mode" => "paused", "enabled" => false)
    ensure
      ENV["CONNECTED_PAYROLL_MODE"] = previous
    end

    it "reports a lock-time change Cornerstone refused" do
      period = publish_november!
      AuditLog.record!(action: Payroll::LockControl::REQUESTED, actor: admin, auditable: period, event_category: "payroll",
        metadata: { requested_action: "change", cornerstone_schedule_version: 2, cornerstone_cutoff_at: zone.local(2026, 11, 19, 17).iso8601 })
      AuditLog.record!(action: Payroll::LockControl::REJECTED, actor: nil, actor_kind: "integration", auditable: period, event_category: "payroll",
        outcome: "failed", metadata: { schedule_version: 2, error: "cutoff is too close to payday" })

      problem = attention(admin).fetch("items").find { |item| item["type"] == "payroll_problem" }

      expect(problem).to include("problem" => "lock_change_refused", "tone" => "needs_fix")
      expect(problem.fetch("change")).to include("state" => "rejected", "action" => "change", "error" => "cutoff is too close to payday",
                                                 "requested_by_name" => "Chels User")
    end

    it "shows a change Cornerstone accepted but hasn't published as information" do
      period = publish_november!
      AuditLog.record!(action: Payroll::LockControl::REQUESTED, actor: admin, auditable: period, event_category: "payroll",
        metadata: { requested_action: "lock_now", cornerstone_schedule_version: 2, cornerstone_cutoff_at: zone.local(2026, 11, 16, 9).iso8601 })

      problem = attention(admin).fetch("items").find { |item| item["type"] == "payroll_problem" }

      expect(problem).to include("problem" => "lock_change_pending", "tone" => "info")
    end
  end

  describe "who sees what" do
    before do
      open_clock(caleb, at: zone.local(2026, 11, 10, 7, 2))
      shift(grace, date: Date.new(2026, 11, 9), approval_status: "pending")
      create(:leave_request, user: grace, start_date: Date.new(2026, 11, 12), end_date: Date.new(2026, 11, 12))
      PayDocumentRequest.create!(user: grace, source: "kiosk", scope: "latest", recipient_kind: "on_file")
      grace.update_columns(kiosk_locked_until: now + 1.hour)
    end

    around do |example|
      previous = ENV["CONNECTED_PAYROLL_MODE"]
      ENV["CONNECTED_PAYROLL_MODE"] = "paused"
      example.run
    ensure
      ENV["CONNECTED_PAYROLL_MODE"] = previous
    end

    it "gives owners and admins every section, payroll problems included" do
      [ owner, admin ].each do |user|
        body = attention(user)
        expect(body.fetch("sections").values).to all(be(true))
        expect(body.fetch("items").map { |item| item["type"] }).to eq(%w[
          open_clock_earlier_day approvals_waiting payroll_problem leave_waiting kiosk_pin_locked pay_stub_requests
        ])
      end
    end

    it "gives managers team time, approvals, leave, PINs and stub requests, but not payroll problems" do
      body = attention(manager)

      expect(body.fetch("sections")).to include("payroll" => false, "team_time" => true, "approvals" => true, "leave" => true)
      expect(body.fetch("items").map { |item| item["type"] }).to eq(%w[
        open_clock_earlier_day approvals_waiting leave_waiting kiosk_pin_locked pay_stub_requests
      ])
    end

    it "refuses employees" do
      get "/api/v1/attention", headers: headers_for(employee)
      expect(response).to have_http_status(:forbidden)

      get "/api/v1/attention"
      expect(response).to have_http_status(:unauthorized)
    end
  end
end
