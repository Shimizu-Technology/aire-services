# frozen_string_literal: true

require "rails_helper"

# How the Nov 11 approval policy reaches the API: supervisors' own pending
# clock time in the queue, and auto-approved shifts shown as "Auto-approved".
RSpec.describe "Time entry approval policy", type: :request do
  include ActiveSupport::Testing::TimeHelpers

  let(:zone) { ActiveSupport::TimeZone[TimeClockService::BUSINESS_TIMEZONE] }
  let(:category) { create(:time_category) }
  let(:employee) { create(:user, :employee, first_name: "Ana", time_tracking_enabled: true, kiosk_enabled: true) }
  let(:manager) { create(:user, :manager, time_tracking_enabled: true, kiosk_enabled: true) }
  let(:admin) { create(:user, :admin) }

  around do |example|
    travel_to(zone.local(2026, 4, 8, 8, 0, 0)) { example.run }
  end

  before do
    [ employee, manager ].each { |user| user.user_time_categories.create!(time_category: category) }
  end

  def headers_for(user)
    { "Authorization" => "Bearer test_token_#{user.id}" }
  end

  def json
    response.parsed_body
  end

  def clock_shift(user, hours: 8)
    post "/api/v1/time_entries/clock_in", params: { time_category_id: category.id }, headers: headers_for(user)
    expect(response).to have_http_status(:created)
    travel hours.hours
    post "/api/v1/time_entries/clock_out", headers: headers_for(user)
    expect(response).to have_http_status(:ok)
    json.fetch("time_entry")
  end

  it "queues a manager's own clock with a reason, approvable by them while #167 is on" do
    Setting.set(Setting::AUTO_APPROVE_ORDINARY_SHIFTS_KEY, "true")
    entry = clock_shift(manager)
    expect(entry).to include("approval_status" => "pending", "auto_approved" => false, "needs_another_approver" => false)

    get "/api/v1/time_entries/pending_approvals", headers: headers_for(manager)
    row = json.fetch("pending_entries").find { |candidate| candidate["id"] == entry["id"] }
    expect(row.fetch("approval_reasons").map { |reason| reason["key"] }).to include("own_time", "unscheduled_clock")

    post "/api/v1/time_entries/#{entry["id"]}/approve", headers: headers_for(manager)
    expect(response).to have_http_status(:ok)
    expect(json.dig("time_entry", "approved_by", "id")).to eq(manager.id)
  end

  it "shows a manager's own pending time as needing another approver while #167 is off" do
    Setting.set(Setting::MANAGERS_CAN_APPROVE_OWN_TIME_KEY, "false")
    entry = clock_shift(manager)

    get "/api/v1/time_entries/pending_approvals", headers: headers_for(manager)
    expect(json.fetch("pending_entries").find { |row| row["id"] == entry["id"] }).to include("needs_another_approver" => true)

    post "/api/v1/time_entries/#{entry["id"]}/approve", headers: headers_for(manager)
    expect(response).to have_http_status(:forbidden)
  end

  it "serializes an auto-approved shift without an approver and keeps it out of the queue" do
    Setting.set(Setting::AUTO_APPROVE_ORDINARY_SHIFTS_KEY, "true")
    entry = clock_shift(employee)
    expect(entry).to include("approval_status" => "approved", "auto_approved" => true, "approved_by" => nil,
      "approval_note" => TimeEntry::AUTO_APPROVAL_NOTE)

    get "/api/v1/time_entries/pending_approvals", headers: headers_for(admin)
    expect(json.fetch("pending_entries").map { |row| row["id"] }).not_to include(entry["id"])

    get "/api/v1/admin/hours_report", params: { start_date: "2026-04-01", end_date: "2026-04-15" }, headers: headers_for(admin)
    expect(response).to have_http_status(:ok)
    report_entries = json.fetch("employees").flat_map { |row| row.fetch("days").flat_map { |day| day.fetch("entries") } }
    expect(report_entries.find { |row| row["id"] == entry["id"] }).to include("auto_approved" => true, "approved_by" => nil)

    get "/api/v1/admin/hours_report/detailed_csv", params: { start_date: "2026-04-01", end_date: "2026-04-15" }, headers: headers_for(admin)
    expect(response).to have_http_status(:ok)
    expect(response.body).to include("Auto-approved")
  end

  it "returns an auto-approved shift to pending on any later edit, the same as a person's approval" do
    Setting.set(Setting::AUTO_APPROVE_ORDINARY_SHIFTS_KEY, "true")
    auto = clock_shift(employee)
    expect(auto).to include("auto_approved" => true)
    travel 16.hours
    Setting.set(Setting::AUTO_APPROVE_ORDINARY_SHIFTS_KEY, "false")
    human = clock_shift(employee)
    post "/api/v1/time_entries/#{human["id"]}/approve", headers: headers_for(admin)
    expect(response).to have_http_status(:ok)

    [ auto, human ].each do |entry|
      patch "/api/v1/time_entries/#{entry["id"]}", params: { time_entry: { description: "Left early for the ramp" } }, headers: headers_for(employee)
      expect(response).to have_http_status(:ok)
      expect(json.fetch("time_entry")).to include("approval_status" => "pending", "auto_approved" => false, "approved_by" => nil, "approved_at" => nil)
      expect(json.dig("time_entry", "approval_note")).to end_with("Employee edited time entry — awaiting admin review")
    end

    get "/api/v1/time_entries/pending_approvals", headers: headers_for(admin)
    expect(json.fetch("pending_entries").map { |row| row["id"] }).to include(auto["id"], human["id"])
    expect(TimeClockService.ordinary_shift_exceptions(TimeEntry.find(auto["id"]))).to include(:edited)
  end

  it "keeps manual entries pending with auto-approval on" do
    Setting.set(Setting::AUTO_APPROVE_ORDINARY_SHIFTS_KEY, "true")

    post "/api/v1/time_entries", params: {
      time_entry: { work_date: "2026-04-07", start_time: "08:00", end_time: "12:00", time_category_id: category.id, description: "Ramp" }
    }, headers: headers_for(employee)

    expect(response).to have_http_status(:created)
    expect(json.fetch("time_entry")).to include("approval_status" => "pending", "auto_approved" => false)
  end
end
