# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Rejecting an employee change", type: :request do
  let(:employee) { create(:user, :employee) }
  let(:admin) { create(:user, :admin) }
  let(:entry) { create(:time_entry, user: employee, entry_method: "clock", status: "completed", approval_status: "pending") }
  let(:headers) { { "Authorization" => "Bearer test_token_#{admin.id}" } }

  before do
    entry.update!(clock_in_at: Time.current.in_time_zone("Pacific/Guam").beginning_of_day + 7.hours, clock_out_at: Time.current.in_time_zone("Pacific/Guam").beginning_of_day + 15.hours)
    original = EmployeeTimeChange.capture(entry)
    entry.update!(end_time: entry.end_time + 40.minutes, original_employee_change: original)
  end

  it "restores original worked time without approving it and records the reason" do
    original = entry.original_employee_change
    post "/api/v1/time_entries/#{entry.id}/reject_change", params: { expected_version: entry.lock_version, note: "Original clock time is correct" }, headers: headers
    expect(response).to have_http_status(:ok)
    expect(entry.reload.hours.to_f).to eq(original["hours"].to_f)
    expect(entry.approval_status).to eq("pending")
    expect(entry.original_employee_change).to be_nil
    expect(entry.rejected_employee_change["manager"]).to eq(admin.full_name)
    expect(AuditLog.where(action: "time_entry.change_rejected").count).to eq(1)
  end

  it "captures the first employee edit and keeps that snapshot across later edits" do
    entry.update!(original_employee_change: nil, description: "Original note")
    employee_headers = { "Authorization" => "Bearer test_token_#{employee.id}" }
    2.times do |attempt|
      patch "/api/v1/time_entries/#{entry.id}", params: { time_entry: { description: "Employee fix #{attempt}", original_employee_change: { hours: 999 } } }, headers: employee_headers
      expect(response).to have_http_status(:ok)
      expect(entry.reload.original_employee_change["description"]).to eq("Original note")
      expect(entry.original_employee_change["hours"].to_f).to eq(entry.hours.to_f)
    end
  end

  it "requires a reason and refuses a shift without a saved change" do
    post "/api/v1/time_entries/#{entry.id}/reject_change", params: { expected_version: entry.lock_version }, headers: headers
    expect(response).to have_http_status(:unprocessable_entity)
    entry.update!(original_employee_change: nil)
    post "/api/v1/time_entries/#{entry.id}/reject_change", params: { expected_version: entry.lock_version, note: "Original" }, headers: headers
    expect(response).to have_http_status(:unprocessable_entity)
  end

  it "refuses a stale version without restoring anything" do
    post "/api/v1/time_entries/#{entry.id}/reject_change", params: { expected_version: entry.lock_version - 1, note: "Original" }, headers: headers
    expect(response).to have_http_status(:conflict)
    expect(entry.reload.original_employee_change).to be_present
  end

  it "refuses employees and kiosk bearer tokens" do
    [ "test_token_#{employee.id}", AireKioskAccessToken.issue_for(admin), AireKioskToken.issue_for(employee) ].each do |token|
      post "/api/v1/time_entries/#{entry.id}/reject_change", params: { expected_version: entry.lock_version, note: "Original" }, headers: { "Authorization" => "Bearer #{token}" }
      expect(response.status).to be_in([ 401, 403 ])
    end
  end
  it "does not let an employee reopen denied time or erase the denial" do
    entry.update!(approval_status: "denied", approved_by: admin, approval_note: "You were not here", original_employee_change: nil)
    patch "/api/v1/time_entries/#{entry.id}", params: { time_entry: { description: "Please reconsider" } },
          headers: { "Authorization" => "Bearer test_token_#{employee.id}" }
    expect(response).to have_http_status(:unprocessable_entity)
    expect(entry.reload.approval_status).to eq("denied")
    expect(entry.approval_note).to eq("You were not here")
    expect(entry.original_employee_change).to be_nil
  end

  it "keeps the snapshot through a manager description edit" do
    snapshot = entry.original_employee_change
    patch "/api/v1/time_entries/#{entry.id}", params: { time_entry: { description: "Manager context" } }, headers: headers
    expect(response).to have_http_status(:ok)
    expect(entry.reload.original_employee_change).to eq(snapshot)
    expect(entry.approval_status).to eq("pending")
  end

  [ ActiveRecord::Deadlocked, ActiveRecord::LockWaitTimeout ].each do |error|
    it "returns payroll_busy for #{error}" do
      allow(EmployeeTimeChange).to receive(:reject!).and_raise(error)
      post "/api/v1/time_entries/#{entry.id}/reject_change", params: { expected_version: entry.lock_version, note: "Original" }, headers: headers
      expect(response).to have_http_status(:conflict)
      expect(response.parsed_body["code"]).to eq("payroll_busy")
    end
  end
  it "never saves an original when an employee edits hand-added time" do
    entry.update!(entry_method: "manual", original_employee_change: nil)
    patch "/api/v1/time_entries/#{entry.id}", params: { time_entry: { description: "Employee added this" } },
          headers: { "Authorization" => "Bearer test_token_#{employee.id}" }
    expect(response).to have_http_status(:ok)
    expect(entry.reload.original_employee_change).to be_nil
    expect(response.parsed_body.dig("time_entry", "original_employee_change")).to be_nil
  end

  it "clears a snapshot when a manager changes payroll inputs" do
    patch "/api/v1/time_entries/#{entry.id}", params: { time_entry: { break_minutes: 15 } }, headers: headers
    expect(response).to have_http_status(:ok)
    expect(entry.reload.original_employee_change).to be_nil
    expect(entry.approval_status).to eq("pending")
  end
end
