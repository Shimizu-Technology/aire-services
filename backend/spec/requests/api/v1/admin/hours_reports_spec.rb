# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Api::V1::Admin::HoursReports", type: :request do
  let(:admin) { create(:user, :admin) }
  let(:employee) { create(:user, :employee, first_name: "Alice", last_name: "Pilot", approval_group: "cfi") }
  let(:category) { create(:time_category, name: "Flight Instruction") }

  let(:auth_headers) { { "Authorization" => "Bearer test_token_#{admin.id}" } }

  def json
    JSON.parse(response.body, symbolize_names: true)
  end

  def create_entry(user:, date:, hours:, start_hour: 9)
    guam = ActiveSupport::TimeZone[TimeClockService::BUSINESS_TIMEZONE]
    create(
      :time_entry,
      user: user,
      time_category: category,
      work_date: date,
      start_time: guam.local(date.year, date.month, date.day, start_hour, 0, 0),
      end_time: guam.local(date.year, date.month, date.day, start_hour, 0, 0) + hours.hours,
      hours: hours,
      status: "completed",
      approval_status: nil,
      overtime_status: "none"
    )
  end

  it "calculates weekly overtime using context outside the selected semi-monthly period" do
    # Week of Sunday May 10 through Saturday May 16. The report starts Friday,
    # but OT still depends on Sun-Thu hours from the prior pay period.
    (Date.new(2026, 5, 10)..Date.new(2026, 5, 14)).each do |date|
      create_entry(user: employee, date: date, hours: 8)
    end
    create_entry(user: employee, date: Date.new(2026, 5, 15), hours: 4)
    create_entry(user: employee, date: Date.new(2026, 5, 16), hours: 2)

    get "/api/v1/admin/hours_report",
        params: { start_date: "2026-05-15", end_date: "2026-05-31", approval_group: "cfi" },
        headers: auth_headers

    expect(response).to have_http_status(:ok)
    employee_row = json.fetch(:employees).first
    expect(employee_row.fetch(:total_hours)).to eq(6.0)
    expect(employee_row.fetch(:regular_hours)).to eq(0.0)
    expect(employee_row.fetch(:overtime_hours)).to eq(6.0)
    expect(employee_row.fetch(:weeks).first.fetch(:context_hours)).to eq(40.0)
    expect(employee_row.fetch(:weeks).first.fetch(:context_note)).to match(/outside this filtered report selection/)
  end

  it "calculates OT against all weekly hours even when category filter narrows displayed hours" do
    category_b = create(:time_category, name: "Admin Duties")
    (Date.new(2026, 6, 1)..Date.new(2026, 6, 5)).each do |date|
      create_entry(user: employee, date: date, hours: 8)
    end
    friday_extra = create_entry(user: employee, date: Date.new(2026, 6, 5), hours: 4, start_hour: 18)
    friday_extra.update!(time_category: category_b)

    get "/api/v1/admin/hours_report",
        params: { start_date: "2026-06-01", end_date: "2026-06-15", time_category_id: category_b.id },
        headers: auth_headers

    expect(response).to have_http_status(:ok)
    employee_row = json.fetch(:employees).first
    expect(employee_row.fetch(:total_hours)).to eq(4.0)
    expect(employee_row.fetch(:regular_hours)).to eq(0.0)
    expect(employee_row.fetch(:overtime_hours)).to eq(4.0)
    expect(employee_row.fetch(:weeks).first.fetch(:weekly_total_hours)).to eq(44.0)
    expect(employee_row.fetch(:weeks).first.fetch(:context_hours)).to eq(40.0)
  end

  it "includes locked_at for period-locked report entries" do
    locked_at = Time.zone.parse("2026-05-20 10:00:00")
    create_entry(user: employee, date: Date.new(2026, 5, 4), hours: 5).update!(locked_at: locked_at)

    get "/api/v1/admin/hours_report",
        params: { start_date: "2026-05-01", end_date: "2026-05-15" },
        headers: auth_headers

    expect(response).to have_http_status(:ok)
    entry_row = json.dig(:employees, 0, :days, 0, :entries, 0)
    expect(entry_row.fetch(:locked_at)).to eq(locked_at.iso8601)
  end

  it "filters reports by department" do
    other_employee = create(:user, :employee, first_name: "Bob", last_name: "Ops", approval_group: "ops_maintenance")
    create_entry(user: employee, date: Date.new(2026, 5, 4), hours: 5)
    create_entry(user: other_employee, date: Date.new(2026, 5, 4), hours: 7)

    get "/api/v1/admin/hours_report",
        params: { start_date: "2026-05-01", end_date: "2026-05-15", approval_group: "ops_maintenance" },
        headers: auth_headers

    expect(response).to have_http_status(:ok)
    expect(json.fetch(:employees).map { |row| row.fetch(:full_name) }).to eq([ "Bob Ops" ])
    expect(json.dig(:summary, :total_hours)).to eq(7.0)
  end
end
