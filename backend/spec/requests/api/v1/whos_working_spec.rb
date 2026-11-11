# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Who's working", type: :request do
  include ActiveSupport::Testing::TimeHelpers

  let(:zone) { ActiveSupport::TimeZone["Pacific/Guam"] }
  let(:manager) { create(:user, :manager) }
  let(:category) { create(:time_category) }
  let(:forgot) { create(:user, :employee, first_name: "Caleb") }
  let(:working) { create(:user, :employee, first_name: "Rosa") }
  let(:finished) { create(:user, :employee, first_name: "Tasi") }

  def open_clock(user, at:, status: "clocked_in")
    create(:time_entry, user: user, time_category: category, work_date: at.to_date, entry_method: "clock",
           status: status, start_time: at, clock_in_at: at, end_time: nil, clock_out_at: nil, hours: 0)
  end

  def workers
    get "/api/v1/time_entries/whos_working", headers: { "Authorization" => "Bearer test_token_#{manager.id}" }
    expect(response).to have_http_status(:ok)
    response.parsed_body.fetch("workers").index_by { |row| row.dig("user", "id") }
  end

  # Just after midnight Guam, when a forgotten clock-out matters most.
  before { travel_to zone.local(2026, 11, 11, 0, 20) }
  after { travel_back }

  it "counts someone still clocked in from an earlier day and points to that entry" do
    stale = open_clock(forgot, at: zone.local(2026, 11, 10, 7, 2))

    row = workers.fetch(forgot.id)
    expect(row).to include("status" => "clocked_in", "open_since_work_date" => "2026-11-10", "open_entry_id" => stale.id)
    expect(row["clock_in_at"]).to eq(stale.clock_in_at.iso8601)
    expect(row["day_entries"].map { |entry| entry["id"] }).to eq([ stale.id ])
    expect(row["completed_hours"]).to be > 17
  end

  it "keeps the earlier-day break state" do
    open_clock(forgot, at: zone.local(2026, 11, 9, 22), status: "on_break")

    expect(workers.fetch(forgot.id)).to include("status" => "on_break", "open_since_work_date" => "2026-11-09")
  end

  it "leaves today's shifts and finished earlier shifts unflagged" do
    open_clock(working, at: zone.local(2026, 11, 11, 0, 5))
    create(:time_entry, user: finished, time_category: category, work_date: Date.new(2026, 11, 10), entry_method: "clock",
           status: "completed", clock_in_at: zone.local(2026, 11, 10, 8), clock_out_at: zone.local(2026, 11, 10, 16))

    rows = workers
    expect(rows.fetch(working.id)).to include("status" => "clocked_in", "open_since_work_date" => nil, "open_entry_id" => nil)
    expect(rows.fetch(finished.id)).to include("status" => "no_schedule", "open_since_work_date" => nil, "day_entries" => [])
  end

  it "ignores open manual entries from earlier days" do
    create(:time_entry, user: forgot, time_category: category, work_date: Date.new(2026, 11, 10), entry_method: "manual",
           status: "clocked_in", end_time: nil, hours: 0)

    expect(workers.fetch(forgot.id)).to include("status" => "no_schedule", "open_since_work_date" => nil)
  end
end
