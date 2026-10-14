# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Payroll date-only time corrections", type: :request do
  let(:zone) { ActiveSupport::TimeZone["Pacific/Guam"] }
  let(:admin) { create(:user, :admin, is_active: true, personal_access_enabled: true) }
  let(:employee) { create(:user, :employee) }
  let(:category) { create(:time_category) }
  let(:grant) { PayrollIntegrationGrant.issue!(user: admin, capabilities: [ "time_correction" ]) }
  let(:headers) do
    {
      "X-Payroll-Shared-Secret" => "date-correction-secret",
      "X-Aire-Delegation-Token" => grant.issued_token,
      "Content-Type" => "application/json"
    }
  end
  let(:entry) do
    create(:time_entry, user: employee, time_category: category, work_date: "2026-11-14",
           start_time: zone.local(2026, 11, 14, 8), end_time: zone.local(2026, 11, 14, 10),
           entry_method: "manual", status: "completed", approval_status: "approved",
           approved_by: admin, approved_at: Time.current)
  end

  around do |example|
    previous = ENV["PAYROLL_SHARED_SECRET"]
    ENV["PAYROLL_SHARED_SECRET"] = "date-correction-secret"
    example.run
  ensure
    ENV["PAYROLL_SHARED_SECRET"] = previous
  end

  def correct(attributes = {})
    post "/api/v1/payroll/cockpit/time_entries/#{entry.id}/correction",
         params: { command_id: SecureRandom.uuid, expected_version: entry.reload.lock_version,
                   work_date: "2026-11-03", reason: "Verified date against the employee time record" }.merge(attributes).to_json,
         headers: headers
  end

  it "moves only the work date, preserves positive duration, and records renewed approval evidence" do
    original_version = entry.lock_version

    expect { correct }.to change(PayrollIntegrationCommand, :count).by(1)

    expect(response).to have_http_status(:ok)
    expect(entry.reload).to have_attributes(work_date: Date.new(2026, 11, 3), hours: 2.0,
                                           approval_status: "pending", approved_by_id: nil, approved_at: nil)
    expect(entry.lock_version).to be > original_version
    expect([ entry.formatted_start_time, entry.formatted_end_time ]).to eq([ "8:00 AM", "10:00 AM" ])
    audit = AuditLog.find_by!(action: "payroll_cockpit.time_entry_corrected", auditable: entry)
    expect(audit.metadata).to include("requires_approval" => true)
    expect(audit.metadata.fetch("before")).to include("work_date" => "2026-11-14", "hours" => 2.0, "approval_status" => "approved")
    expect(audit.metadata.fetch("after")).to include("work_date" => "2026-11-03", "hours" => 2.0, "approval_status" => "pending")
  end

  it "relocates retained daytime breaks without changing their duration or net hours" do
    entry.update!(end_time: zone.local(2026, 11, 14, 17), break_minutes: 30)
    entry.time_entry_breaks.create!(start_time: zone.local(2026, 11, 14, 12), end_time: zone.local(2026, 11, 14, 12, 30))

    correct

    expect(response).to have_http_status(:ok)
    expect(entry.reload).to have_attributes(hours: 8.5, break_minutes: 30, approval_status: "pending")
    expect(entry.time_entry_breaks.reload.sole).to have_attributes(
      start_time: zone.local(2026, 11, 3, 12), end_time: zone.local(2026, 11, 3, 12, 30), duration_minutes: 30
    )
  end

  it "retains aggregate break minutes when no individual break rows were captured" do
    entry.update!(end_time: zone.local(2026, 11, 14, 17), break_minutes: 30)

    correct

    expect(response).to have_http_status(:ok)
    expect(entry.reload).to have_attributes(hours: 8.5, break_minutes: 30)
    expect(entry.time_entry_breaks).to be_empty
  end

  it "preserves an overnight clock duration and relocates breaks on both sides of midnight" do
    entry.update!(entry_method: "clock", start_time: zone.local(2026, 11, 14, 22),
                  end_time: zone.local(2026, 11, 15, 6), clock_in_at: zone.local(2026, 11, 14, 22),
                  clock_out_at: zone.local(2026, 11, 15, 6), break_minutes: 45)
    entry.time_entry_breaks.create!(start_time: zone.local(2026, 11, 14, 23, 45), end_time: zone.local(2026, 11, 15, 0, 15))
    entry.time_entry_breaks.create!(start_time: zone.local(2026, 11, 15, 2), end_time: zone.local(2026, 11, 15, 2, 15))

    correct

    expect(response).to have_http_status(:ok)
    expect(entry.reload).to have_attributes(hours: 7.25, break_minutes: 45, approval_status: "pending")
    expect([ entry.formatted_start_time, entry.formatted_end_time ]).to eq([ "10:00 PM", "6:00 AM" ])
    breaks = entry.time_entry_breaks.reload.order(:start_time)
    expect(breaks.map { |row| [ row.start_time, row.end_time, row.duration_minutes ] }).to eq([
      [ zone.local(2026, 11, 3, 23, 45), zone.local(2026, 11, 4, 0, 15), 30 ],
      [ zone.local(2026, 11, 4, 2), zone.local(2026, 11, 4, 2, 15), 15 ]
    ])
  end

  it "keeps a missing clock-out open when only its date changes" do
    entry.update!(entry_method: "clock", status: "clocked_in", end_time: nil, hours: 0,
                  clock_in_at: zone.local(2026, 11, 14, 8), clock_out_at: nil)

    correct

    expect(response).to have_http_status(:ok)
    expect(entry.reload).to have_attributes(work_date: Date.new(2026, 11, 3), status: "clocked_in", end_time: nil, clock_out_at: nil, hours: 0)
  end

  [ "25:00", "08:70", "not-a-time" ].each do |invalid_time|
    it "rejects invalid supplied time #{invalid_time.inspect} without changing the entry or saving a receipt" do
      before = entry.attributes

      expect { correct(start_time: invalid_time) }.not_to change(PayrollIntegrationCommand, :count)

      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.parsed_body.fetch("error")).to eq("Corrected times must use HH:MM or ISO 8601")
      expect(entry.reload.attributes).to eq(before)
      expect(AuditLog.where(action: "payroll_cockpit.time_entry_corrected", auditable: entry)).to be_empty
    end
  end

  it "continues accepting explicit HH:MM and offset-bearing ISO times with the date" do
    correct(start_time: "09:00", end_time: "2026-11-14T12:30:00+10:00")

    expect(response).to have_http_status(:ok)
    expect(entry.reload).to have_attributes(work_date: Date.new(2026, 11, 3), hours: 3.5)
    expect([ entry.formatted_start_time, entry.formatted_end_time ]).to eq([ "9:00 AM", "12:30 PM" ])
  end

  it "continues rejecting overlapping break replacements atomically" do
    before = entry.attributes

    expect do
      correct(breaks: [ { start_time: "08:15", end_time: "09:00" }, { start_time: "08:45", end_time: "09:15" } ])
    end.not_to change(PayrollIntegrationCommand, :count)

    expect(response).to have_http_status(:unprocessable_entity)
    expect(response.parsed_body.fetch("error")).to eq("Breaks cannot overlap")
    expect(entry.reload.attributes).to eq(before)
    expect(entry.time_entry_breaks).to be_empty
  end

  it "rejects breaks outside the corrected shift without changing retained break evidence" do
    entry.time_entry_breaks.create!(start_time: zone.local(2026, 11, 14, 8, 30), end_time: zone.local(2026, 11, 14, 9))
    original_entry = entry.reload.attributes
    original_breaks = entry.time_entry_breaks.map(&:attributes)

    expect { correct(breaks: [ { start_time: "07:00", end_time: "07:30" } ]) }.not_to change(PayrollIntegrationCommand, :count)

    expect(response).to have_http_status(:unprocessable_entity)
    expect(response.parsed_body.fetch("error")).to eq("Breaks must fall within the corrected shift")
    expect(entry.reload.attributes).to eq(original_entry)
    expect(entry.time_entry_breaks.reload.map(&:attributes)).to eq(original_breaks)
  end
end
