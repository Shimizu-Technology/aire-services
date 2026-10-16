# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Payroll partial time corrections", type: :request do
  let(:zone) { ActiveSupport::TimeZone["Pacific/Guam"] }
  let(:admin) { create(:user, :admin, is_active: true, personal_access_enabled: true) }
  let(:employee) { create(:user, :employee) }
  let(:category) { create(:time_category) }
  let(:grant) { PayrollIntegrationGrant.issue!(user: admin, capabilities: [ "time_correction" ]) }
  let(:headers) do
    { "X-Payroll-Shared-Secret" => "partial-correction-secret",
      "X-Aire-Delegation-Token" => grant.issued_token, "Content-Type" => "application/json" }
  end
  let(:original_start) { zone.local(2026, 11, 14, 8, 0, 17.123456r) }
  let(:original_end) { zone.local(2026, 11, 14, 17, 0, 43.654321r) }
  let(:entry) do
    create(:time_entry, user: employee, time_category: category, work_date: "2026-11-14",
           start_time: original_start, end_time: original_end, clock_in_at: original_start,
           clock_out_at: original_end, entry_method: "clock", status: "completed",
           approval_status: "approved", approved_by: admin, approved_at: Time.current)
  end

  around do |example|
    previous = ENV["PAYROLL_SHARED_SECRET"]
    ENV["PAYROLL_SHARED_SECRET"] = "partial-correction-secret"
    example.run
  ensure
    ENV["PAYROLL_SHARED_SECRET"] = previous
  end

  def correct(attributes)
    post "/api/v1/payroll/cockpit/time_entries/#{entry.id}/correction",
         params: { command_id: SecureRandom.uuid, expected_version: entry.reload.lock_version,
                   reason: "Verified the edited fields; retain all other captured time" }.merge(attributes).to_json,
         headers: headers
  end

  def add_break
    entry.time_entry_breaks.create!(start_time: zone.local(2026, 11, 14, 12, 0, 59.123456r),
                                  end_time: zone.local(2026, 11, 14, 12, 30, 0.654321r))
  end

  it "changes only a completed start and retains the untouched real clock-out down to microseconds" do
    entry.update!(description: "Retain the original work note",
                  start_time: zone.local(2026, 11, 14, 13, 59, 19.427187r),
                  end_time: zone.local(2026, 11, 14, 14, 0, 32.935086r),
                  clock_in_at: zone.local(2026, 11, 14, 13, 59, 19.427187r),
                  clock_out_at: zone.local(2026, 11, 14, 14, 0, 32.935086r))
    original_time_end = entry.reload.end_time
    original_punch_end = entry.clock_out_at
    version = entry.lock_version

    expect { correct(start_time: "13:45") }.to change(PayrollIntegrationCommand, :count).by(1)

    expect(response).to have_http_status(:ok)
    expect(entry.reload).to have_attributes(clock_in_at: zone.local(2026, 11, 14, 13, 45),
                                           clock_out_at: original_punch_end, end_time: original_time_end,
                                           hours: 0.26, description: "Retain the original work note",
                                           approval_status: "pending", approved_by_id: nil,
                                           approved_at: nil, lock_version: version + 1)
    expect(response.parsed_body.fetch("time_entry")).to include(
      "clock_in_at" => "2026-11-14T03:45:00.000000Z", "clock_out_at" => "2026-11-14T04:00:32.935086Z"
    )
    audit = AuditLog.find_by!(action: "payroll_cockpit.time_entry_corrected", auditable: entry)
    expect(audit.metadata.fetch("before")).to include("clock_out_at" => "2026-11-14T04:00:32.935086Z")
    expect(audit.metadata.fetch("after")).to include("clock_out_at" => "2026-11-14T04:00:32.935086Z", "hours" => 0.26)
    expect(PayrollIntegrationCommand.last).to have_attributes(expected_version: version, response_status: 200)
  end

  it "changes only a completed end and preserves the original start and its precise actual punch" do
    original_time_start = entry.reload.start_time

    correct(end_time: "2026-11-14T18:00:51.765432+10:00")

    expect(response).to have_http_status(:ok)
    expect(entry.reload).to have_attributes(start_time: original_time_start, clock_in_at: original_start,
                                           clock_out_at: zone.local(2026, 11, 14, 18, 0, 51.765432r),
                                           hours: 10.01, approval_status: "pending")
    expect(response.parsed_body.fetch("time_entry")).to include(
      "clock_in_at" => "2026-11-13T22:00:17.123456Z", "clock_out_at" => "2026-11-14T08:00:51.765432Z"
    )
  end

  it "preserves every captured punch and detailed break row when only the description changes" do
    add_break
    entry.update!(break_minutes: 29)
    before = entry.reload.attributes.slice("work_date", "start_time", "end_time", "clock_in_at", "clock_out_at", "hours", "break_minutes")
    original_breaks = entry.time_entry_breaks.reload.map(&:attributes)

    correct(description: "Clarified the work description without editing time")

    expect(response).to have_http_status(:ok)
    expect(entry.reload.attributes.slice(*before.keys)).to eq(before)
    expect(entry.time_entry_breaks.reload.map(&:attributes)).to eq(original_breaks)
    expect(entry.approval_status).to eq("pending")
  end

  it "validates retained breaks against an edited shift without replacing their rows or precision" do
    add_break
    entry.update!(break_minutes: 29)
    original_breaks = entry.time_entry_breaks.reload.map(&:attributes)

    correct(start_time: "09:00")

    expect(response).to have_http_status(:ok)
    expect(entry.reload).to have_attributes(clock_in_at: zone.local(2026, 11, 14, 9), clock_out_at: original_end,
                                           hours: 7.53, break_minutes: 29, approval_status: "pending")
    expect(entry.time_entry_breaks.reload.map(&:attributes)).to eq(original_breaks)
  end

  it "rejects a shift contraction that excludes an omitted existing break and rolls back the correction" do
    add_break
    entry.update!(break_minutes: 29)
    original_entry = entry.reload.attributes
    original_breaks = entry.time_entry_breaks.reload.map(&:attributes)

    expect { correct(start_time: "13:00") }.not_to change(PayrollIntegrationCommand, :count)

    expect(response).to have_http_status(:unprocessable_entity)
    expect(response.parsed_body.fetch("error")).to eq("Breaks must fall within the corrected shift")
    expect(entry.reload.attributes).to eq(original_entry)
    expect(entry.time_entry_breaks.reload.map(&:attributes)).to eq(original_breaks)
    expect(AuditLog.where(action: "payroll_cockpit.time_entry_corrected", auditable: entry)).to be_empty
  end

  it "accepts a breaks-only replacement and preserves raw sibling and untouched endpoint precision" do
    add_break
    entry.time_entry_breaks.create!(start_time: zone.local(2026, 11, 14, 15, 0, 7.345678r),
                                  end_time: zone.local(2026, 11, 14, 15, 15, 11.456789r))
    entry.update!(break_minutes: 44)
    original_times = entry.reload.attributes.slice("start_time", "end_time", "clock_in_at", "clock_out_at")
    source_breaks = Payroll::CockpitTimeEntrySerializer.new(entry).as_json.fetch(:breaks)
    replacement = source_breaks.map { |row| row.slice(:start_time, :end_time) }
    replacement.first[:start_time] = "12:05"

    correct(breaks: replacement)

    expect(response).to have_http_status(:ok)
    expect(entry.reload.attributes.slice(*original_times.keys)).to eq(original_times)
    expect(entry).to have_attributes(hours: 8.34, break_minutes: 40, approval_status: "pending")
    breaks = entry.time_entry_breaks.reload.order(:start_time)
    expect(breaks.map { |row| [ row.start_time, row.end_time, row.duration_minutes ] }).to eq([
      [ zone.local(2026, 11, 14, 12, 5), zone.local(2026, 11, 14, 12, 30, 0.654321r), 25 ],
      [ zone.local(2026, 11, 14, 15, 0, 7.345678r), zone.local(2026, 11, 14, 15, 15, 11.456789r), 15 ]
    ])
    expect(response.parsed_body.fetch("time_entry").fetch("breaks").last).to include(
      "start_time" => "2026-11-14T05:00:07.345678Z", "end_time" => "2026-11-14T05:15:11.456789Z"
    )
  end

  it "anchors an end-only overnight correction to the retained nominal start date" do
    punch = zone.local(2026, 11, 14, 22, 0, 17.123456r)
    entry.update!(start_time: punch, end_time: zone.local(2026, 11, 15, 6, 0, 43.654321r),
                  clock_in_at: punch, clock_out_at: zone.local(2026, 11, 15, 6, 0, 43.654321r))

    correct(end_time: "07:00")

    expect(response).to have_http_status(:ok)
    expect(entry.reload).to have_attributes(clock_in_at: punch, clock_out_at: zone.local(2026, 11, 15, 7),
                                           hours: 9.0, approval_status: "pending")
    expect(entry.formatted_end_time).to eq("7:00 AM")
  end

  it "keeps an incomplete live session's actual punch and break rows when only its nominal start changes" do
    entry.update!(status: "clocked_in", end_time: nil, clock_out_at: nil, hours: 0)
    entry.time_entry_breaks.create!(start_time: zone.local(2026, 11, 14, 9), end_time: zone.local(2026, 11, 14, 9, 15))
    original_breaks = entry.time_entry_breaks.reload.map(&:attributes)

    correct(start_time: "09:00")

    expect(response).to have_http_status(:ok)
    expect(entry.reload).to have_attributes(status: "clocked_in", clock_in_at: original_start,
                                           clock_out_at: nil, end_time: nil, hours: 0, approval_status: "pending")
    expect(entry.start_time.in_time_zone(zone).strftime("%H:%M")).to eq("09:00")
    expect(entry.time_entry_breaks.reload.map(&:attributes)).to eq(original_breaks)
  end

  [ "", nil ].each do |cleared_description|
    it "clears an explicit #{cleared_description.inspect} description without resending captured time" do
      entry.update!(description: "An obsolete work description")
      original_times = entry.reload.attributes.slice("start_time", "end_time", "clock_in_at", "clock_out_at", "hours")

      expect { correct(description: cleared_description) }.to change(PayrollIntegrationCommand, :count).by(1)

      expect(response).to have_http_status(:ok)
      expect(entry.reload).to have_attributes(description: cleared_description, approval_status: "pending")
      expect(entry.attributes.slice(*original_times.keys)).to eq(original_times)
      expect(response.parsed_body.fetch("time_entry").fetch("description")).to eq(cleared_description)
    end
  end

  it "clears the description alongside an explicit time correction instead of silently retaining it" do
    entry.update!(description: "An obsolete work description")

    correct(start_time: "09:00", description: "")

    expect(response).to have_http_status(:ok)
    expect(entry.reload).to have_attributes(description: "", clock_in_at: zone.local(2026, 11, 14, 9),
                                           clock_out_at: original_end, hours: 8.01, approval_status: "pending")
    expect(response.parsed_body.fetch("time_entry").fetch("description")).to eq("")
  end
end
