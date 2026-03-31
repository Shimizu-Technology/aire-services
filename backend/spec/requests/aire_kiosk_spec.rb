# frozen_string_literal: true

require "rails_helper"

RSpec.describe "AIRE kiosk", type: :request do
  let(:employee_pin) { "731248" }

  let!(:employee) do
    create(:user, :employee, first_name: "Mindy").tap do |user|
      user.skip_kiosk_pin_presence_validation = true
      user.rotate_kiosk_pin!(employee_pin)
    end
  end
  let!(:time_category) do
    TimeCategory.create!(
      key: "aire_flight",
      name: "AIRE Flight Time",
      description: "Flight instruction",
      hourly_rate_cents: 3000,
      is_active: true
    )
  end

  before do
    guam_now = Time.current.in_time_zone(TimeClockService::BUSINESS_TIMEZONE)
    guam_today = guam_now.to_date
    start_hour = [ guam_now.hour - 1, 0 ].max
    end_hour = [ guam_now.hour + 2, 23 ].min

    Schedule.create!(
      user: employee,
      work_date: guam_today,
      start_time: Time.utc(2000, 1, 1, start_hour, guam_now.min, 0),
      end_time: Time.utc(2000, 1, 1, end_hour, guam_now.min, 0)
    )
  end

  it "verifies a PIN and returns a kiosk token" do
    post "/api/v1/aire/kiosk/verify", params: { pin: employee_pin }

    expect(response).to have_http_status(:ok)

    body = JSON.parse(response.body)
    expect(body["employee"]["full_name"]).to eq(employee.full_name)
    expect(body["kiosk_token"]).to be_present
    expect(body["available_categories"].first["key"]).to eq("aire_flight")
  end

  it "clocks in through the kiosk and marks the source as kiosk" do
    post "/api/v1/aire/kiosk/verify", params: { pin: employee_pin }
    token = JSON.parse(response.body).fetch("kiosk_token")

    post "/api/v1/aire/kiosk/clock_in", params: { kiosk_token: token, time_category_id: time_category.id }

    expect(response).to have_http_status(:created)

    entry = employee.time_entries.order(created_at: :desc).first
    expect(entry.clock_source).to eq("kiosk")
    expect(entry.time_category_id).to eq(time_category.id)
    expect(entry.status).to eq("clocked_in")
  end

  it "allows admins to reset a kiosk PIN" do
    admin = create(:user, :admin)

    post "/api/v1/admin/users/#{employee.id}/reset_kiosk_pin",
         params: { pin: "731249" },
         headers: { "Authorization" => "Bearer test_token_#{admin.id}" }

    expect(response).to have_http_status(:ok)

    employee.reload
    expect(employee.verify_kiosk_pin("731249")).to be(true)
  end
end
