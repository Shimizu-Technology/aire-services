# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Api::V1::ScheduleTimePresets", type: :request do
  let(:employee) { create(:user, :employee) }
  let(:auth_headers) { { "Authorization" => "Bearer test_token_#{employee.id}" } }

  before do
    ScheduleTimePreset.create!(
      label: "9-5",
      start_time: Time.utc(2000, 1, 1, 9, 0, 0),
      end_time: Time.utc(2000, 1, 1, 17, 0, 0),
      position: 1,
      active: true
    )
    ScheduleTimePreset.create!(
      label: "Hidden",
      start_time: Time.utc(2000, 1, 1, 6, 0, 0),
      end_time: Time.utc(2000, 1, 1, 14, 0, 0),
      position: 0,
      active: false
    )
  end

  it "returns active presets in position order" do
    get "/api/v1/schedule_time_presets", headers: auth_headers

    expect(response).to have_http_status(:ok)

    body = JSON.parse(response.body)
    expect(body.fetch("presets").map { |preset| preset.fetch("label") }).to eq([ "9-5" ])
    expect(body.fetch("presets").first).to include(
      "start_time" => "09:00",
      "end_time" => "17:00",
      "formatted_start_time" => "9:00 AM",
      "formatted_end_time" => "5:00 PM"
    )
  end
end
