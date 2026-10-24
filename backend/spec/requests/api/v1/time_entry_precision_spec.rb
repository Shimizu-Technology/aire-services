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

  [ false, true ].each do |overnight|
    it "moves the whole #{overnight ? 'overnight' : 'daytime'} shift and precise retained breaks on a date-only correction" do
      if overnight
        shifted_start = Time.iso8601("2026-10-20T12:00:59.123456Z")
        entry.update!(start_time: shifted_start, clock_in_at: shifted_start,
          end_time: shifted_start + 8.hours, clock_out_at: shifted_start + 8.hours)
      end
      row = entry.time_entry_breaks.create!(start_time: entry.clock_in_at + 3.hours,
        end_time: entry.clock_in_at + 3.hours + 30.minutes + 12.345678.seconds)
      entry.update!(break_minutes: 30)
      original = facts
      old_work_date = entry.work_date
      edit({ work_date: (old_work_date + 1.day).iso8601 })
      expect(entry.reload).to have_attributes(work_date: old_work_date + 1.day, approval_status: "pending", hours: original.fetch("hours"))
      expect(entry.clock_in_at).to eq(original.fetch("clock_in_at") + 1.day)
      expect(entry.clock_out_at).to eq(original.fetch("clock_out_at") + 1.day)
      expect(entry.start_time).to eq(original.fetch("start_time"))
      expect(entry.end_time).to eq(original.fetch("end_time"))
      before_break = original.fetch("breaks").sole
      expect(row.reload).to have_attributes(start_time: before_break.fetch("start_time") + 1.day,
        end_time: before_break.fetch("end_time") + 1.day, duration_minutes: before_break.fetch("duration_minutes"))
      expect(entry.time_entry_breaks.pluck(:id)).to eq([ row.id ])
      audit = AuditLog.where(auditable: entry, action: "time_entry.updated").last
      expect(audit.changes_made.fetch("clock_in_at")).to eq("from" => original.fetch("clock_in_at").iso8601(6), "to" => entry.clock_in_at.iso8601(6))
      expect(audit.changes_made.fetch("breaks").fetch("from").sole.fetch("start_time")).to eq(before_break.fetch("start_time").iso8601(6))
      revision = PayrollTimeEntryRevision.where(source_time_entry_id: entry.id).order(:id).last
      expect(Time.find_zone!("UTC").parse(revision.snapshot.fetch("time_entry").fetch("clock_in_at"))).to eq(entry.clock_in_at)
    end
  end

  it "moves retained breaks by the date delta when correcting date and times together" do
    row = entry.time_entry_breaks.create!(start_time: start + 3.hours, end_time: start + 3.hours + 30.minutes)
    entry.update!(break_minutes: 30)
    original_start = row.start_time
    edit({ work_date: "2026-10-21", start_time: "09:00", end_time: "17:00" })
    expect(entry.reload).to have_attributes(approval_status: "pending", hours: 7.5,
      clock_in_at: Time.iso8601("2026-10-20T23:00:00Z"), clock_out_at: Time.iso8601("2026-10-21T07:00:00Z"))
    expect(row.reload.start_time).to eq(original_start + 1.day)
    expect(entry.time_entry_breaks.pluck(:id)).to eq([ row.id ])
  end

  [ :start_time, :end_time ].each do |field|
    it "rejects a zone-less ISO #{field} without changing the entry" do
      original = facts
      patch "/api/v1/time_entries/#{entry.id}", headers: { "Authorization" => "Bearer test_token_#{admin.id}" },
        params: { time_entry: { field => (field == :start_time ? "2026-10-19T22:30:23.123456" : "2026-10-20T06:30:23.123456") } }, as: :json
      expect(response).to have_http_status(:unprocessable_entity)
      expect(facts).to eq(original)
    end
  end

  it "rejects zone-less ISO break endpoints without changing the entry" do
    original = facts
    patch "/api/v1/time_entries/#{entry.id}", headers: { "Authorization" => "Bearer test_token_#{admin.id}" },
      params: { time_entry: { breaks: [ { start_time: "2026-10-20T02:00:00", end_time: "2026-10-20T02:30:00" } ] } }, as: :json
    expect(response).to have_http_status(:unprocessable_entity)
    expect(facts).to eq(original)
  end


  it "retains the nominal-versus-actual clock-out difference during an explicit date move" do
    entry.update!(end_time: stop - 1.hour)
    original = facts
    edit({ work_date: "2026-10-19" })
    expect(entry.reload.clock_out_at).to eq(original.fetch("clock_out_at") - 1.day)
    expect(entry.end_time).to eq(original.fetch("end_time"))
    expect(entry.hours).to eq(original.fetch("hours"))
    expect(entry.approval_status).to eq("pending")
  end

  it "shifts an active entry and its retained open break without closing either" do
    entry.update!(status: "on_break", end_time: nil, clock_out_at: nil, hours: 0)
    row = entry.time_entry_breaks.create!(start_time: start + 3.hours)
    edit({ work_date: "2026-10-21" })
    expect(entry.reload).to have_attributes(status: "on_break", hours: 0, clock_in_at: start + 1.day, clock_out_at: nil,
      approval_status: "pending")
    expect(row.reload).to have_attributes(start_time: start + 3.hours + 1.day, end_time: nil)
  end

  it "rolls back a date-and-time correction whose shifted retained break is outside the new shift" do
    entry.time_entry_breaks.create!(start_time: start + 4.hours, end_time: start + 5.hours)
    original = facts
    patch "/api/v1/time_entries/#{entry.id}", headers: { "Authorization" => "Bearer test_token_#{admin.id}" },
      params: { time_entry: { work_date: "2026-10-21", end_time: "11:00" } }, as: :json
    expect(response).to have_http_status(:unprocessable_entity)
    expect(entry.reload.work_date).to eq(Date.new(2026, 10, 20))
    expect(facts).to eq(original)
  end

  it "accepts explicit numeric-offset timestamps for clock and break corrections" do
    edit({ start_time: "2026-10-20T08:05:23.654321+10:00", breaks: [
      { start_time: "2026-10-20T11:00:23.123456+1000", end_time: "2026-10-20T11:30:29.654321+10:00" }
    ] })
    expect(entry.reload.clock_in_at).to eq(Time.iso8601("2026-10-19T22:05:23.654321Z"))
    expect(entry.time_entry_breaks.sole.start_time).to eq(Time.iso8601("2026-10-20T01:00:23.123456Z"))
  end

  it "rejects shifting an active retained break into the future without changing any source facts" do
    active_start = Time.iso8601("2026-10-22T00:00:00Z")
    entry.update!(work_date: "2026-10-22", status: "on_break", start_time: active_start, clock_in_at: active_start,
      end_time: nil, clock_out_at: nil, hours: 0)
    entry.time_entry_breaks.create!(start_time: Time.iso8601("2026-10-23T23:00:00Z"))
    original = facts
    patch "/api/v1/time_entries/#{entry.id}", headers: { "Authorization" => "Bearer test_token_#{admin.id}" },
      params: { time_entry: { work_date: "2026-10-23" } }, as: :json
    expect(response).to have_http_status(:unprocessable_entity)
    expect(facts).to eq(original)
  end

  it "rejects a date shift that moves a distinct actual clock-out into the future" do
    in_at = Time.iso8601("2026-10-22T14:00:00Z")
    entry.update!(work_date: "2026-10-23", start_time: in_at, clock_in_at: in_at,
      end_time: Time.iso8601("2026-10-22T23:00:00Z"), clock_out_at: Time.iso8601("2026-10-23T01:00:00Z"))
    original = facts
    patch "/api/v1/time_entries/#{entry.id}", headers: { "Authorization" => "Bearer test_token_#{admin.id}" },
      params: { time_entry: { work_date: "2026-10-24" } }, as: :json
    expect(response).to have_http_status(:unprocessable_entity)
    expect(facts).to eq(original)
  end
end
