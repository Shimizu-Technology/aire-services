# frozen_string_literal: true

require "rails_helper"

# A person can't be in two shifts at once. Added time and edits that would
# overlap another shift that still counts are refused with a plain message.
RSpec.describe "Overlapping shifts", type: :request do
  include ActiveSupport::Testing::TimeHelpers

  let(:zone) { ActiveSupport::TimeZone["Pacific/Guam"] }
  let(:category) { create(:time_category) }
  let(:employee) { create(:user, :employee, first_name: "Ethan", last_name: "Cruz") }
  let(:marcus) { create(:user, :employee, first_name: "Marcus", last_name: "Quinata") }
  let(:manager) { create(:user, :manager, first_name: "Roke", last_name: "Aguon") }

  before do
    travel_to zone.local(2026, 11, 14, 21)
    [ employee, marcus, manager ].each { |user| user.user_time_categories.create!(time_category: category) }
  end
  after { travel_back }

  def headers_for(user)
    { "Authorization" => "Bearer test_token_#{user.id}" }
  end

  def clock(hour, minute = 0)
    zone.local(2000, 1, 1, hour, minute)
  end

  def json
    JSON.parse(response.body)
  end

  # A clocked shift, completed unless `out` is nil.
  def clocked(user, date, from, to, **attributes)
    starts = zone.local(date.year, date.month, date.day, *from)
    ends = to && zone.local(date.year, date.month, date.day, *to)
    ends += 1.day if ends && ends <= starts
    create(:time_entry, user: user, time_category: category, work_date: date, entry_method: "clock",
           status: ends ? "completed" : "clocked_in", start_time: starts, end_time: ends,
           clock_in_at: starts, clock_out_at: ends, hours: ends ? ((ends - starts) / 3600.0).round(2) : 0,
           **attributes)
  end

  def add(user, as: user, date: "2026-11-14", start: "08:00", finish: "17:00")
    post "/api/v1/time_entries", headers: headers_for(as), params: { time_entry: {
      work_date: date, start_time: start, end_time: finish, time_category_id: category.id,
      **(as == user ? {} : { user_id: user.id })
    } }
  end

  describe "adding time" do
    it "refuses an employee's added shift on top of their clocked shift, naming it" do
      clocked(employee, Date.new(2026, 11, 14), [ 7 ], [ 13, 20 ])

      expect { add(employee) }.not_to change(TimeEntry, :count)

      expect(response).to have_http_status(:unprocessable_entity)
      expect(json).to include(
        "code" => "overlapping_shift",
        "error" => "This overlaps your 7:00 AM–1:20 PM shift on Sat, Nov 14. Change the times or pick another day."
      )
    end

    it "names the person when a supervisor adds time for someone else" do
      clocked(marcus, Date.new(2026, 11, 13), [ 6, 45 ], [ 14, 45 ])

      expect { add(marcus, as: manager, date: "2026-11-13", start: "08:00", finish: "16:30") }.not_to change(TimeEntry, :count)

      expect(response).to have_http_status(:unprocessable_entity)
      expect(json["error"]).to eq(
        "This overlaps Marcus Quinata's 6:45 AM–2:45 PM shift on Fri, Nov 13. Change the times or pick another day."
      )
    end

    it "refuses an exact duplicate of an added shift that's still waiting" do
      create(:time_entry, user: employee, time_category: category, work_date: Date.new(2026, 11, 12),
             start_time: clock(8), end_time: clock(17), hours: 9, approval_status: "pending")

      add(employee, date: "2026-11-12")

      expect(response).to have_http_status(:unprocessable_entity)
      expect(json["error"]).to start_with("This overlaps your 8:00 AM–5:00 PM shift on Thu, Nov 12.")
    end

    it "allows a shift that starts exactly when another ends" do
      clocked(employee, Date.new(2026, 11, 14), [ 7 ], [ 13, 20 ])

      expect { add(employee, start: "13:20", finish: "17:00") }.to change(TimeEntry, :count).by(1)

      expect(response).to have_http_status(:created)
    end

    it "ignores denied shifts" do
      clocked(employee, Date.new(2026, 11, 14), [ 7 ], [ 13, 20 ], approval_status: "denied")

      expect { add(employee) }.to change(TimeEntry, :count).by(1)
    end

    it "ignores other people's shifts" do
      clocked(marcus, Date.new(2026, 11, 14), [ 7 ], [ 13, 20 ])

      expect { add(employee) }.to change(TimeEntry, :count).by(1)
    end

    it "catches an overnight shift running into the next morning" do
      clocked(employee, Date.new(2026, 11, 12), [ 22 ], [ 6 ])

      add(employee, date: "2026-11-13", start: "05:00", finish: "09:00")

      expect(response).to have_http_status(:unprocessable_entity)
      expect(json["error"]).to start_with("This overlaps your 10:00 PM–6:00 AM shift on Thu, Nov 12.")
    end

    it "allows time after an overnight shift ends" do
      clocked(employee, Date.new(2026, 11, 12), [ 22 ], [ 6 ])

      add(employee, date: "2026-11-13", start: "06:00", finish: "09:00")

      expect(response).to have_http_status(:created)
    end

    it "treats an open clock as covering everything after it started" do
      clocked(employee, Date.new(2026, 11, 12), [ 7 ], nil)

      add(employee, date: "2026-11-14", start: "08:00", finish: "12:00")

      expect(response).to have_http_status(:unprocessable_entity)
      expect(json["error"]).to eq(
        "This overlaps your shift on Thu, Nov 12 that started at 7:00 AM and is still on the clock. " \
        "Change the times or pick another day."
      )
    end

    it "allows time before an open clock started" do
      clocked(employee, Date.new(2026, 11, 14), [ 13 ], nil)

      add(employee, start: "06:00", finish: "12:00")

      expect(response).to have_http_status(:created)
    end
  end

  describe "editing time" do
    it "refuses an employee's fix that would run into their next shift" do
      morning = clocked(employee, Date.new(2026, 11, 14), [ 7 ], [ 12 ])
      clocked(employee, Date.new(2026, 11, 14), [ 13 ], [ 17 ])

      patch "/api/v1/time_entries/#{morning.id}", headers: headers_for(employee),
            params: { time_entry: { end_time: "14:00" } }

      expect(response).to have_http_status(:unprocessable_entity)
      expect(json["error"]).to eq("This overlaps your 1:00 PM–5:00 PM shift on Sat, Nov 14. Change the times or pick another day.")
      expect(morning.reload.end_time.in_time_zone(zone).strftime("%H:%M")).to eq("12:00")
    end

    it "refuses a supervisor's edit that moves a shift onto another day's shift" do
      added = create(:time_entry, user: marcus, time_category: category, work_date: Date.new(2026, 11, 12),
                     start_time: clock(8), end_time: clock(16, 30), hours: 8.5, approval_status: "pending")
      clocked(marcus, Date.new(2026, 11, 13), [ 6, 45 ], [ 14, 45 ])

      patch "/api/v1/time_entries/#{added.id}", headers: headers_for(manager),
            params: { time_entry: { work_date: "2026-11-13" } }

      expect(response).to have_http_status(:unprocessable_entity)
      expect(json["error"]).to start_with("This overlaps Marcus Quinata's 6:45 AM–2:45 PM shift on Fri, Nov 13.")
      expect(added.reload.work_date).to eq(Date.new(2026, 11, 12))
    end

    it "lets a shift be edited without counting itself, and allows edits that don't touch the times" do
      shift = clocked(employee, Date.new(2026, 11, 14), [ 7 ], [ 12 ])

      patch "/api/v1/time_entries/#{shift.id}", headers: headers_for(employee),
            params: { time_entry: { end_time: "12:30" } }
      expect(response).to have_http_status(:ok)

      # Already-overlapping rows from before this rule can still get a note.
      legacy = create(:time_entry, user: employee, time_category: category, work_date: Date.new(2026, 11, 14),
                      start_time: clock(8), end_time: clock(9), hours: 1, approval_status: "approved")
      patch "/api/v1/time_entries/#{legacy.id}", headers: headers_for(manager),
            params: { time_entry: { description: "Checked with Ethan" } }
      expect(response).to have_http_status(:ok)
    end

    it "refuses a Fix clock-out that runs past a later shift" do
      forgotten = clocked(employee, Date.new(2026, 11, 13), [ 7 ], nil)
      create(:time_entry, user: employee, time_category: category, work_date: Date.new(2026, 11, 13),
             start_time: clock(18), end_time: clock(20), hours: 2, approval_status: "approved")

      patch "/api/v1/time_entries/#{forgotten.id}", headers: headers_for(manager), params: {
        correction_reason: "Confirmed with Ethan",
        time_entry: { review_action: "end_clock", expected_version: forgotten.lock_version,
                      stop_date: "2026-11-13", end_time: "19:00", time_category_id: category.id }
      }

      expect(response).to have_http_status(:unprocessable_entity)
      expect(json["error"]).to eq(
        "This overlaps Ethan Cruz's 6:00 PM–8:00 PM shift on Fri, Nov 13. Change the times or pick another day."
      )
      expect(forgotten.reload.status).to eq("clocked_in")

      patch "/api/v1/time_entries/#{forgotten.id}", headers: headers_for(manager), params: {
        correction_reason: "Confirmed with Ethan",
        time_entry: { review_action: "end_clock", expected_version: forgotten.lock_version,
                      stop_date: "2026-11-13", end_time: "15:00", time_category_id: category.id }
      }
      expect(response).to have_http_status(:ok)
      expect(forgotten.reload.status).to eq("completed")
    end

    it "refuses sending a denied shift back for review when it overlaps a counted one" do
      denied = clocked(employee, Date.new(2026, 11, 13), [ 8 ], [ 12 ], approval_status: "denied")
      clocked(employee, Date.new(2026, 11, 13), [ 9 ], [ 17 ])

      patch "/api/v1/time_entries/#{denied.id}", headers: headers_for(manager), params: {
        correction_reason: "Ethan says he worked it",
        time_entry: { review_action: "resubmit_denied", expected_version: denied.lock_version }
      }

      expect(response).to have_http_status(:unprocessable_entity)
      expect(json["error"]).to start_with("This overlaps Ethan Cruz's 9:00 AM–5:00 PM shift on Fri, Nov 13.")
      expect(denied.reload.approval_status).to eq("denied")
    end
  end

  describe "clocking" do
    it "doesn't change clock-in or clock-out" do
      employee.update!(time_tracking_enabled: true, kiosk_enabled: true)
      create(:time_entry, user: employee, time_category: category, work_date: Date.new(2026, 11, 14),
             start_time: clock(20), end_time: clock(22), hours: 2, approval_status: "pending")

      post "/api/v1/time_entries/clock_in", headers: headers_for(employee), params: { time_category_id: category.id }
      expect(response).to have_http_status(:success)
      travel 30.minutes
      post "/api/v1/time_entries/clock_out", headers: headers_for(employee)
      expect(response).to have_http_status(:success)
      expect(TimeEntry.where(user: employee).count).to eq(2)
    end
  end
end
