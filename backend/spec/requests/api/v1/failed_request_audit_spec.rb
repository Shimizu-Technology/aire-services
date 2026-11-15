# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Audit rows for requests that didn't go through", type: :request do
  include ActiveSupport::Testing::TimeHelpers
  let(:admin) { create(:user, :admin) }
  let(:employee) { create(:user, :employee) }
  let(:category) { create(:time_category) }
  let(:zone) { ActiveSupport::TimeZone["Pacific/Guam"] }
  let(:start) { zone.local(2026, 11, 1, 8) }
  let(:entry) do
    create(:time_entry, user: employee, time_category: category, work_date: start.to_date, entry_method: "clock",
           status: "clocked_in", start_time: start, clock_in_at: start, end_time: nil, clock_out_at: nil, hours: 0)
  end

  before do
    travel_to zone.local(2026, 11, 24, 12)
    employee.user_time_categories.create!(time_category: category)
  end
  after { travel_back }

  it "records what the person was told when a request failed" do
    patch "/api/v1/time_entries/#{entry.id}", headers: { "Authorization" => "Bearer test_token_#{admin.id}" },
          params: { correction_reason: "Checking", time_entry: { review_action: "bogus", expected_version: entry.lock_version } }
    expect(response).to have_http_status(:unprocessable_entity)

    log = AuditLog.where(auditable_type: "TimeEntry", auditable_id: entry.id).order(:id).last
    expect(log.outcome).to eq("failed")
    expect(log.metadata).to include("response_status" => 422, "error_message" => response.parsed_body.fetch("error"))
    expect(log.metadata.fetch("error_message")).to be_present
  end

  it "records no error message for a request that worked" do
    patch "/api/v1/time_entries/#{entry.id}", headers: { "Authorization" => "Bearer test_token_#{admin.id}" },
          params: { time_entry: { description: "Fine" } }
    expect(response).to have_http_status(:ok)
    expect(AuditLog.where(auditable_type: "TimeEntry", auditable_id: entry.id).order(:id).last.metadata).not_to have_key("error_message")
  end
end
