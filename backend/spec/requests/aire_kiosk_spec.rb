# frozen_string_literal: true

require "rails_helper"

RSpec.describe "AIRE kiosk", type: :request do
  include ActiveSupport::Testing::TimeHelpers

  let(:employee_pin) { "731248" }
  let(:guam_zone) { ActiveSupport::TimeZone[TimeClockService::BUSINESS_TIMEZONE] }
  let(:frozen_time) { guam_zone.local(2026, 4, 2, 9, 0, 0) }
  let!(:admin) { create(:user, :admin) }
  let(:kiosk_access_token) { AireKioskAccessToken.issue_for(admin) }

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

  around do |example|
    travel_to(frozen_time) { example.run }
  end

  before do
    UserTimeCategory.create!(user: employee, time_category: time_category)
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
    post "/api/v1/aire/kiosk/verify", params: { pin: employee_pin, kiosk_access_token: kiosk_access_token }

    expect(response).to have_http_status(:ok)

    body = JSON.parse(response.body)
    expect(body["employee"]["full_name"]).to eq(employee.full_name)
    expect(body["kiosk_token"]).to be_present
    expect(body["available_categories"].first["key"]).to eq("aire_flight")
  end

  it "clocks in through the kiosk and marks the source as kiosk" do
    post "/api/v1/aire/kiosk/verify", params: { pin: employee_pin, kiosk_access_token: kiosk_access_token }
    token = JSON.parse(response.body).fetch("kiosk_token")

    post "/api/v1/aire/kiosk/clock_in",
         params: { kiosk_access_token: kiosk_access_token, kiosk_token: token, time_category_id: time_category.id }

    expect(response).to have_http_status(:created)

    entry = employee.time_entries.order(created_at: :desc).first
    expect(entry.clock_source).to eq("kiosk")
    expect(entry.time_category_id).to eq(time_category.id)
    expect(entry.status).to eq("clocked_in")
  end

  it "allows admins to reset a kiosk PIN" do
    post "/api/v1/admin/users/#{employee.id}/reset_kiosk_pin",
         params: { pin: "731249" },
         headers: { "Authorization" => "Bearer test_token_#{admin.id}" }

    expect(response).to have_http_status(:ok)

    employee.reload
    expect(employee.verify_kiosk_pin("731249")).to be(true)
  end

  it "rejects inactive users at the kiosk" do
    employee.update!(is_active: false)

    post "/api/v1/aire/kiosk/verify", params: { pin: employee_pin, kiosk_access_token: kiosk_access_token }

    expect(response).to have_http_status(:unprocessable_entity)
    expect(JSON.parse(response.body).fetch("error")).to eq("Invalid PIN")
  end

  it "rejects kiosk access until an admin unlocks it" do
    post "/api/v1/aire/kiosk/verify", params: { pin: employee_pin }

    expect(response).to have_http_status(:unprocessable_entity)
    expect(JSON.parse(response.body).fetch("error")).to match(/Kiosk is locked/i)
  end
end
