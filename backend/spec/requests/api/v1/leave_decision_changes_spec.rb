# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Leave decision corrections", type: :request do
  include ActiveSupport::Testing::TimeHelpers
  let(:manager) { create(:user, :manager, approval_group: "ops") }
  let(:employee) { create(:user, :employee, approval_group: "cfi") }
  let(:leave) { create(:leave_request, user: employee) }
  let(:headers) { { "Authorization" => "Bearer test_token_#{manager.id}" } }
  before { Setting.set_approval_groups!([ { key: "cfi", label: "CFI" }, { key: "ops", label: "Ops/Maint" } ]) }
  def data = JSON.parse(response.body)
  def approve
    post "/api/v1/leave_requests/#{leave.id}/approve", params: { version: leave.reload.lock_version }, headers: headers
    expect(response).to have_http_status(:ok)
    leave.reload
  end
  def correct(params = {}, auth = headers)
    post "/api/v1/leave_requests/#{leave.id}/change_decision",
         params: { version: leave.reload.lock_version, status: "declined", reason: "Coverage changed" }.merge(params), headers: auth
  end
  def undo(auth = headers)
    post "/api/v1/leave_requests/#{leave.id}/undo", params: { version: leave.reload.lock_version }, headers: auth
  end

  it "undoes atomically with exactly two domain audit rows" do
    approve
    undo
    expect(response).to have_http_status(:ok)
    expect(leave.reload).to have_attributes(status: "pending", reviewed_at: nil, reviewed_by_id: nil, lock_version: 2)
    expect(AuditLog.where(auditable: leave, event_category: "leave").order(:id).pluck(:action)).to eq(%w[leave_request.approved leave_request.decision_undone])
    expect(data["leave_request"]["decision_history"].first).to include("from" => "approved", "to" => "pending", "actor" => manager.full_name)
  end
  it "undoes a decline" do
    post "/api/v1/leave_requests/#{leave.id}/decline", headers: headers
    undo
    expect(response).to have_http_status(:ok)
    expect(leave.reload.status).to eq("pending")
  end
  it "refuses undo at 15 minutes but permits a reasoned correction" do
    freeze_time do
      approve
      travel 15.minutes
      undo
      expect(response).to have_http_status(:unprocessable_entity)
      expect(data["error"]).to include("15-minute")
      correct
      expect(response).to have_http_status(:ok)
      expect(data["leave_request"]["decision_history"].first).to include("reason" => "Coverage changed", "from" => "approved", "to" => "declined")
    end
  end
  it "refuses Undo after a correction without replacing the employee note" do
    post "/api/v1/leave_requests/#{leave.id}/approve", params: { review_note: "Enjoy your time off" }, headers: headers
    correct
    expect(response).to have_http_status(:ok)
    expect(data["leave_request"]["undo_expires_at"]).to be_nil
    expect(leave.reload.review_note).to eq("Enjoy your time off")
    undo
    expect(response).to have_http_status(:unprocessable_entity)
    expect(leave.reload).to have_attributes(status: "declined", review_note: "Enjoy your time off")
  end
  it "clears the note written by an undone initial decision" do
    post "/api/v1/leave_requests/#{leave.id}/decline", params: { review_note: "Coverage unavailable" }, headers: headers
    undo
    expect(response).to have_http_status(:ok)
    expect(leave.reload.review_note).to be_nil
  end
  it "refuses reopening for inactive and terminated employees" do
    approve
    correct
    employee.update!(is_active: false)
    %w[approved pending].each do |status|
      correct(status: status)
      expect(response).to have_http_status(:unprocessable_entity)
      expect(data["error"]).to include("inactive or terminated")
    end
    employee.update!(terminated_at: Time.current, termination_effective_on: Date.current)
    correct(status: "pending")
    expect(response).to have_http_status(:unprocessable_entity)
    expect(leave.reload.status).to eq("declined")
  end
  it "returns a plain conflict for optimistic locking errors" do
    approve
    allow_any_instance_of(LeaveDecisionChange).to receive(:call!).and_raise(ActiveRecord::StaleObjectError.new(leave, "update"))
    correct
    expect(response).to have_http_status(:conflict)
    expect(data).to eq("error" => "This request changed. Refresh and try again.")
  end
  it "filters approved leave by overlapping dates" do
    approve
    get "/api/v1/leave_requests", params: { status: "approved", start_date: leave.end_date + 1.day }, headers: headers
    expect(data["leave_requests"]).to be_empty
    get "/api/v1/leave_requests", params: { status: "approved", start_date: leave.end_date }, headers: headers
    expect(data["leave_requests"].pluck("id")).to eq([ leave.id ])
  end
  it "requires a version for correction and rejects stale initial decisions" do
    post "/api/v1/leave_requests/#{leave.id}/approve", params: { version: 9 }, headers: headers
    expect(response).to have_http_status(:conflict)
    approve
    [ 0, nil ].each do |version|
      correct(version: version)
      expect(response).to have_http_status(:conflict)
      expect(leave.reload.status).to eq("approved")
    end
  end
  it "requires another approver to give a reason instead of using Undo" do
    approve
    admin = create(:user, :admin)
    auth = { "Authorization" => "Bearer test_token_#{admin.id}" }
    undo(auth)
    expect(response).to have_http_status(:unprocessable_entity)
    correct({}, auth)
    expect(response).to have_http_status(:ok)
  end
  it "rejects blank, long, unchanged and invalid corrections" do
    approve
    [ { reason: " " }, { reason: "x" * 501 }, { status: "approved" }, { status: "cancelled" } ].each do |params|
      correct(params)
      expect(response).to have_http_status(:unprocessable_entity)
      expect(leave.reload.status).to eq("approved")
    end
  end
  it "rejects employee corrections and self review" do
    approve
    correct({}, { "Authorization" => "Bearer test_token_#{employee.id}" })
    expect(response).to have_http_status(:forbidden)
    leave.update!(user: manager)
    correct
    expect(response).to have_http_status(:unprocessable_entity)
    expect(data["error"]).to include("own leave")
  end
  it "refuses to reopen a decline when another active request overlaps" do
    approve
    correct
    create(:leave_request, user: employee, start_date: leave.start_date, end_date: leave.end_date)
    correct(status: "pending")
    expect(response).to have_http_status(:unprocessable_entity)
    expect(data["error"]).to eq("#{employee.full_name} already has other time off waiting or approved on these dates.")
    expect(leave.reload.status).to eq("declined")
  end
  it "rolls back the decision if auditing fails" do
    approve
    allow(AuditLog).to receive(:record!).and_raise(ActiveRecord::RecordInvalid.new(AuditLog.new))
    correct
    expect(response).to have_http_status(:unprocessable_entity)
    expect(leave.reload).to have_attributes(status: "approved", lock_version: 1)
  end
  it "keeps undone decisions in history, departments visible, and employee lists private" do
    approve
    undo
    get "/api/v1/leave_requests", params: { view: "decisions" }, headers: headers
    expect(data["leave_requests"].map { |row| row["id"] }).to include(leave.id)
    expect(data["leave_requests"].first["user"]).to include("department" => "CFI", "approval_group_keys" => [ "cfi" ])
    outsider = create(:user, :employee)
    get "/api/v1/leave_requests", params: { view: "decisions" }, headers: { "Authorization" => "Bearer test_token_#{outsider.id}" }
    expect(data["leave_requests"]).to eq([])
  end
  it "includes legacy decisions without audit events, newest decision first and paginated" do
    leave.update!(status: "approved", reviewed_by: manager, reviewed_at: 1.day.ago)
    latest = create(:leave_request, user: create(:user, :employee), status: "declined", reviewed_by: manager, reviewed_at: Time.current)
    get "/api/v1/leave_requests", params: { view: "decisions", per_page: 1 }, headers: headers
    expect(response).to have_http_status(:ok)
    expect(data["pagination"]["total_count"]).to eq(2)
    expect(data["leave_requests"].map { |row| row["id"] }).to eq([ latest.id ])
  end
end
