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
