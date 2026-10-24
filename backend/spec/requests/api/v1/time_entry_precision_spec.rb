# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Time entry edit precision", type: :request do
  include ActiveSupport::Testing::TimeHelpers
  let(:admin) { create(:user, :admin) }
  let(:employee) { create(:user, :employee) }
  let(:category) { create(:time_category) }
  let(:start) { Time.iso8601("2026-10-19T22:00:59.123456Z") }
  let(:stop) { start + 8.hours - 59.seconds }
  let(:entry) do
    create(:time_entry, user: employee, time_category: category, work_date: "2026-10-20",
      entry_method: "clock", status: "completed", start_time: start, end_time: stop,
      clock_in_at: start, clock_out_at: stop, approval_status: "approved", approved_by: admin, approved_at: start,
      description: "Original")
  end
  before do
    travel_to Time.utc(2026, 10, 24, 0)
    employee.user_time_categories.create!(time_category: category)
  end
  after { travel_back }

  def edit(attributes, actor: admin)
    patch "/api/v1/time_entries/#{entry.id}", headers: { "Authorization" => "Bearer test_token_#{actor.id}" },
      params: { time_entry: attributes }, as: :json
    expect(response).to have_http_status(:ok), response.body
  end

  def facts
    entry.reload.attributes.slice("start_time", "end_time", "clock_in_at", "clock_out_at", "hours", "break_minutes")
      .merge("breaks" => entry.time_entry_breaks.reload.map(&:attributes))
  end

  [ :admin, :employee ].each do |role|
    it "preserves all precise facts when #{role} adds and clears notes; retains employee review policy" do
      entry.time_entry_breaks.create!(start_time: start + 3.hours, end_time: start + 3.hours + 30.minutes + 12.345678.seconds)
      entry.update!(break_minutes: 30)
      original = facts
      edit({ description: "Added" }, actor: public_send(role))
      expect(facts).to eq(original)
      expect(entry.approval_status).to eq(role == :admin ? "approved" : "pending")
      edit({ description: "" }, actor: public_send(role))
      expect(facts).to eq(original)
      expect(entry.description).to eq("")
    end
    it "preserves explicit ISO microseconds and requires review for #{role} time corrections" do
      corrected = "2026-10-19T22:05:23.654321Z"
      edit({ start_time: corrected }, actor: public_send(role))
      expect(entry.reload.clock_in_at).to eq(Time.iso8601(corrected))
      expect(entry.start_time.utc.strftime("%H:%M:%S.%6N")).to eq("22:05:23.654321")
      expect(entry.approval_status).to eq("pending")
    end
  end

  it "preserves the actual punch distinct from a nominal corrected clock-out" do
    entry.update!(end_time: stop - 1.hour)
    original = facts
    edit({ description: "Nominal end confirmed" })
    expect(facts).to eq(original)
    expect(entry.approval_status).to eq("approved")
  end

  it "preserves an active precise punch and open break" do
    entry.update!(status: "on_break", end_time: nil, clock_out_at: nil, hours: 0)
    entry.time_entry_breaks.create!(start_time: start + 3.hours)
    original = facts
    edit({ description: "Still working" })
    expect(facts).to eq(original)
    expect(entry.status).to eq("on_break")
  end

  it "does not replace detailed breaks for unchanged aggregate minutes" do
    entry.time_entry_breaks.create!(start_time: start + 3.hours, end_time: start + 3.hours + 30.minutes)
    entry.update!(break_minutes: 30)
    original = facts
    edit({ description: "Aggregate unchanged", break_minutes: 30 })
    expect(facts).to eq(original)
    expect(entry.approval_status).to eq("approved")
  end

  it "requires review and allows approval only after administrator correction of a held punch" do
    entry.update!(clock_out_at: start + 26.hours, end_time: start + 26.hours)
    expect(entry.reload.hours).to eq(0)
    post "/api/v1/time_entries/#{entry.id}/approve", headers: { "Authorization" => "Bearer test_token_#{admin.id}" }
    expect(response).to have_http_status(:unprocessable_entity)
    expect(JSON.parse(response.body).fetch("error")).to match(/administrator correction/i)
    edit({ end_time: (start + 8.hours).iso8601(6) })
    expect(entry.reload).to have_attributes(hours: 8, approval_status: "pending")
    post "/api/v1/time_entries/#{entry.id}/approve", headers: { "Authorization" => "Bearer test_token_#{admin.id}" }
    expect(response).to have_http_status(:ok)
    expect(entry.reload.approval_status).to eq("approved")
  end

  it "serializes actual punches and breaks with microseconds for partial editor changes" do
    row = entry.time_entry_breaks.create!(start_time: start + 3.hours, end_time: start + 3.hours + 30.minutes + 12.345678.seconds)
    get "/api/v1/time_entries/#{entry.id}", headers: { "Authorization" => "Bearer test_token_#{admin.id}" }
    data = response.parsed_body.fetch("time_entry")
    expect(Time.iso8601(data.fetch("clock_in_at"))).to eq(start)
    expect(Time.iso8601(data.fetch("breaks").sole.fetch("end_time"))).to eq(row.reload.end_time)
  end

  it "keeps calculated hours authoritative when a client submits hours alone" do
    original = facts
    edit({ hours: 23 })
    expect(facts).to eq(original)
  end

  it "preserves explicit ISO precision for detailed break corrections" do
    break_start = "2026-10-20T02:00:23.123456Z"
    break_end = "2026-10-20T02:30:29.654321Z"
    edit({ breaks: [ { start_time: break_start, end_time: break_end } ] })
    row = entry.time_entry_breaks.sole
    expect(row.start_time).to eq(Time.iso8601(break_start))
    expect(row.end_time).to eq(Time.iso8601(break_end))
    expect(entry.reload.approval_status).to eq("pending")
  end

  it "anchors an end-only overnight edit to the retained precise start on its work date" do
    overnight_start = Time.iso8601("2026-10-20T12:00:59.123456Z")
    entry.update!(start_time: overnight_start, clock_in_at: overnight_start,
      end_time: overnight_start + 8.hours, clock_out_at: overnight_start + 8.hours)
    edit({ end_time: "07:00" })
    expect(entry.reload.clock_in_at).to eq(overnight_start)
    expect(entry.clock_out_at).to eq(Time.iso8601("2026-10-20T21:00:00Z"))
    expect(entry.approval_status).to eq("pending")
  end

  it "rejects shortening a shift across an untouched detailed break without rewriting it" do
    entry.time_entry_breaks.create!(start_time: start + 4.hours, end_time: start + 5.hours)
    entry.update!(break_minutes: 60)
    original = facts
    patch "/api/v1/time_entries/#{entry.id}", headers: { "Authorization" => "Bearer test_token_#{admin.id}" },
      params: { time_entry: { end_time: "11:00" } }, as: :json
    expect(response).to have_http_status(:unprocessable_entity)
    expect(response.parsed_body.fetch("error")).to match(/breaks must fall within/i)
    expect(facts).to eq(original)
  end

  it "rejects an aggregate override that contradicts retained detailed breaks" do
    entry.time_entry_breaks.create!(start_time: start + 4.hours, end_time: start + 5.hours)
    entry.update!(break_minutes: 60)
    original = facts
    patch "/api/v1/time_entries/#{entry.id}", headers: { "Authorization" => "Bearer test_token_#{admin.id}" },
      params: { time_entry: { break_minutes: 0 } }, as: :json
    expect(response).to have_http_status(:unprocessable_entity)
    expect(response.parsed_body.fetch("error")).to match(/detailed breaks/i)
    expect(facts).to eq(original)
  end
end
