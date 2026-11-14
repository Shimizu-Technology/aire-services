# frozen_string_literal: true

require "rails_helper"
require "csv"

RSpec.describe "GET /api/v1/admin/hours_report?summary_only=1", type: :request do
  let(:owner) { create(:user, :owner) }
  let(:admin) { create(:user, :admin) }
  let(:manager) { create(:user, :manager) }
  let(:employee) { create(:user, :employee, first_name: "Caleb", last_name: "Perez", approval_group: "ops_maintenance") }
  let(:category) { create(:time_category, name: "Ground Operations") }
  let(:guam) { ActiveSupport::TimeZone[TimeClockService::BUSINESS_TIMEZONE] }
  let(:params) { { start_date: "2026-11-01", end_date: "2026-11-15" } }

  def headers_for(user)
    { "Authorization" => "Bearer test_token_#{user.id}" }
  end

  def json
    JSON.parse(response.body, symbolize_names: true)
  end

  def create_entry(date:, hours:, approval_status: nil, status: "completed")
    starts = guam.local(date.year, date.month, date.day, 7, 0, 0)
    create(
      :time_entry,
      user: employee,
      time_category: category,
      work_date: date,
      start_time: starts,
      end_time: status == "completed" ? starts + hours.hours : nil,
      hours: status == "completed" ? hours : 0,
      status: status,
      entry_method: "clock",
      clock_source: "kiosk",
      approval_status: approval_status,
      overtime_status: "none"
    )
  end

  before do
    create_entry(date: Date.new(2026, 11, 2), hours: 8)
    create_entry(date: Date.new(2026, 11, 3), hours: 8.5)
    create_entry(date: Date.new(2026, 11, 9), hours: 9, approval_status: "pending")
    create_entry(date: Date.new(2026, 11, 10), hours: 0, status: "clocked_in")
  end

  it "keeps every total and flag but leaves out the per-entry rows" do
    get "/api/v1/admin/hours_report", params: params, headers: headers_for(admin)
    full = json

    get "/api/v1/admin/hours_report", params: params.merge(summary_only: "1"), headers: headers_for(admin)

    expect(response).to have_http_status(:ok)
    expect(json[:summary_only]).to be(true)
    expect(json[:summary]).to eq(full[:summary])
    expect(json[:breakdowns]).to eq(full[:breakdowns])

    row = json[:employees].find { |item| item[:id] == employee.id }
    full_row = full[:employees].find { |item| item[:id] == employee.id }
    expect(row.slice(:total_hours, :regular_hours, :overtime_hours, :entries_count, :issues, :quality, :weeks))
      .to eq(full_row.slice(:total_hours, :regular_hours, :overtime_hours, :entries_count, :issues, :quality, :weeks))
    expect(row[:total_hours]).to eq(16.5)
    expect(row[:issues]).to include(pending_count: 1, open_clock_count: 1)
    expect(row).not_to have_key(:excluded_entries)
    expect(row[:days].map { |day| day[:work_date] }).to eq(%w[2026-11-02 2026-11-03])
    expect(row[:days]).to all(satisfy { |day| !day.key?(:entries) })
    expect(full_row[:days].first[:entries]).to be_present
    expect(full_row[:excluded_entries].size).to eq(2)
  end

  it "returns the full report when summary_only is absent or false" do
    get "/api/v1/admin/hours_report", params: params.merge(summary_only: "0"), headers: headers_for(admin)

    expect(response).to have_http_status(:ok)
    expect(json).not_to have_key(:summary_only)
    expect(json[:employees].find { |item| item[:id] == employee.id }[:days].first[:entries]).to be_present
  end

  it "doesn't trim the detailed CSV export" do
    get "/api/v1/admin/hours_report/detailed_csv",
        params: params.merge(summary_only: "1", acknowledge_draft: "true"),
        headers: headers_for(admin)

    expect(response).to have_http_status(:ok)
    rows = CSV.parse(response.body.sub(/\A﻿/, ""))
    expect(rows.flatten.join(" ")).to include("2026-11-02", "2026-11-03")
  end

  describe "waiting_hours" do
    def summary_row(range = params)
      get "/api/v1/admin/hours_report", params: range.merge(summary_only: "1"), headers: headers_for(manager)
      expect(response).to have_http_status(:ok)
      json[:employees].find { |item| item[:id] == employee.id }
    end

    it "adds the completed shifts still waiting, so total + waiting is every hour worked" do
      row = summary_row

      # 8 + 8.5 approved; the 9h shift waits; the open clock isn't a completed shift yet.
      expect(row[:total_hours]).to eq(16.5)
      expect(row[:waiting_hours]).to eq(9.0)
    end

    it "leaves denied shifts out of both" do
      create_entry(date: Date.new(2026, 11, 4), hours: 6, approval_status: "denied")

      row = summary_row
      expect(row[:total_hours]).to eq(16.5)
      expect(row[:waiting_hours]).to eq(9.0)
    end

    it "counts an added shift nobody reviewed as waiting" do
      create(:time_entry, user: employee, time_category: category, work_date: Date.new(2026, 11, 5),
        start_time: guam.local(2026, 11, 5, 8), end_time: guam.local(2026, 11, 5, 12), hours: 4,
        status: "completed", entry_method: "manual", approval_status: nil, overtime_status: "none")

      expect(summary_row[:waiting_hours]).to eq(13.0)
    end

    it "waits an overnight shift across the period edge in its own work date's period, like the full report" do
      create(:time_entry, user: employee, time_category: category, work_date: Date.new(2026, 10, 31),
        start_time: guam.local(2026, 10, 31, 22), end_time: guam.local(2026, 11, 1, 6), hours: 8,
        clock_in_at: guam.local(2026, 10, 31, 22), clock_out_at: guam.local(2026, 11, 1, 6),
        status: "completed", entry_method: "clock", clock_source: "kiosk", approval_status: "pending", overtime_status: "none")

      expect(summary_row[:waiting_hours]).to eq(9.0)
      expect(summary_row(start_date: "2026-10-16", end_date: "2026-10-31")[:waiting_hours]).to eq(8.0)

      get "/api/v1/admin/hours_report", params: params, headers: headers_for(manager)
      full_row = json[:employees].find { |item| item[:id] == employee.id }
      waiting_in_full = full_row[:excluded_entries].select { |entry| entry[:approval_status] == "pending" }.sum { |entry| entry[:total_hours] }
      expect(waiting_in_full).to eq(9.0)
    end

    it "is in the full report row too, with the same value" do
      get "/api/v1/admin/hours_report", params: params, headers: headers_for(admin)
      expect(json[:employees].find { |item| item[:id] == employee.id }[:waiting_hours]).to eq(summary_row[:waiting_hours])
    end
  end

  {
    owner: :ok,
    admin: :ok,
    manager: :ok,
    employee: :forbidden
  }.each do |role, status|
    it "answers #{status} for #{role == :manager ? 'a manager (exports hours reports)' : "an #{role}"}" do
      user = role == :employee ? employee : public_send(role)
      expect(user.can_export_hours_reports?).to be(status == :ok)

      get "/api/v1/admin/hours_report", params: params.merge(summary_only: "1"), headers: headers_for(user)

      expect(response).to have_http_status(status)
      if status == :ok
        expect(json[:summary_only]).to be(true)
        expect(json[:employees].find { |item| item[:id] == employee.id }[:issues][:open_clock_count]).to eq(1)
      else
        expect(json).not_to have_key(:employees)
      end
    end
  end
end
