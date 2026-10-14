# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Schedule leave availability", type: :request do
  include ActiveSupport::Testing::TimeHelpers

  let(:admin) { create(:user, :admin) }
  let(:employee) { create(:user, :employee) }
  let(:headers) { { "Authorization" => "Bearer test_token_#{admin.id}" } }

  it "shows approved availability even without shifts, omitting private notes and other statuses" do
    approved = create(:leave_request, user: employee, status: "approved", start_date: "2026-11-07", end_date: "2026-11-09", reason: "Private health detail", review_note: "Private review")
    %w[pending declined cancelled].each_with_index do |status, i|
      create(:leave_request, user: create(:user, :employee), status: status, start_date: Date.new(2026, 11, 8) + i, end_date: Date.new(2026, 11, 8) + i)
    end
    create(:leave_request, status: "approved", start_date: "2026-11-15", end_date: "2026-11-15")

    get "/api/v1/schedules", params: { week: "2026-11-08" }, headers: headers

    expect(response).to have_http_status(:ok)
    data = JSON.parse(response.body)
    expect(data.fetch("schedules")).to be_empty
    expect(data.fetch("approved_leave")).to eq([
      { "id" => approved.id, "user_id" => employee.id, "start_date" => "2026-11-07", "end_date" => "2026-11-09" }
    ])
    expect(response.body).not_to include("Private health", "Private review")
  end

  it "checks inclusive dates and the selected employee and still permits a conflicting shift" do
    leave = create(:leave_request, user: employee, status: "approved", start_date: "2026-11-08", end_date: "2026-11-09")
    other = create(:user, :employee)
    create(:leave_request, user: other, status: "approved", start_date: "2026-11-09", end_date: "2026-11-09")
    get "/api/v1/schedules", params: { user_id: employee.id, start_date: "2026-11-09", end_date: "2026-11-09" }, headers: headers
    expect(JSON.parse(response.body).fetch("approved_leave").map { |row| row.fetch("user_id") }).to eq([ employee.id ])

    attributes = { user_id: employee.id, work_date: "2026-11-09", start_time: "08:00", end_time: "17:00" }
    expect do
      post "/api/v1/schedules", params: { schedule: attributes }, headers: headers
    end.not_to change(Schedule, :count)
    expect(response).to have_http_status(:unprocessable_entity)
    expect(JSON.parse(response.body).fetch("code")).to eq("leave_conflict_acknowledgement_required")
    expect do
      post "/api/v1/schedules", params: { schedule: attributes.merge(acknowledge_leave_conflict: true, acknowledged_leave_ids: [ leave.id ], leave_conflict_reason: " ") }, headers: headers
    end.not_to change(Schedule, :count)
    expect do
      post "/api/v1/schedules", params: { schedule: attributes.merge(acknowledge_leave_conflict: true, acknowledged_leave_ids: [ leave.id ], leave_conflict_reason: "Employee and scheduler agreed to retain the shift") }, headers: headers
    end.to change(Schedule, :count).by(1)
    expect(response).to have_http_status(:created)
    expect(Schedule.last.hours).to eq(9)
    get "/api/v1/schedules", headers: headers
    expect(JSON.parse(response.body).dig("schedules", 0, "approved_leave_conflict")).to be(true)
    decision = AuditLog.where(action: "schedule.leave_conflict_acknowledged").sole
    expect(decision.user_id).to eq(admin.id)
    expect(decision.auditable).to eq(Schedule.last)
    expect(decision.metadata).to include("leave_unchanged" => true, "reason" => "Employee and scheduler agreed to retain the shift")
    expect(leave.reload.status).to eq("approved")

    get "/api/v1/schedules", params: { user_id: employee.id, start_date: "2026-11-10", end_date: "2026-11-10" }, headers: headers
    expect(JSON.parse(response.body).fetch("approved_leave")).to be_empty
  end
  it "returns validation messages without leave conflicts and preserves rejected updates" do
    invalid_attributes = { user_id: employee.id, work_date: "2026-11-09", start_time: "08:00", end_time: "07:00" }
    expect do
      post "/api/v1/schedules", params: { schedule: invalid_attributes }, headers: headers
    end.not_to change(Schedule, :count)
    expect(response).to have_http_status(:unprocessable_entity)
    expect(JSON.parse(response.body).fetch("errors")).to include("End time must be after start time")

    schedule = Schedule.create!(user: employee, work_date: "2026-11-08", start_time: Time.utc(2000, 1, 1, 8), end_time: Time.utc(2000, 1, 1, 17), created_by: admin)
    expect do
      patch "/api/v1/schedules/#{schedule.id}", params: { schedule: { end_time: "07:00" } }, headers: headers
    end.not_to change { schedule.reload.end_time }
    expect(response).to have_http_status(:unprocessable_entity)
    expect(JSON.parse(response.body).fetch("errors")).to include("End time must be after start time")
    expect(AuditLog.where(action: "schedule.leave_conflict_acknowledged")).to be_empty
  end

  [ nil, 0 ].each do |invalid_user_id|
    it "rejects create/update/bulk for invalid employee #{invalid_user_id.inspect} with structured validation" do
      attributes = { user_id: invalid_user_id, work_date: "2026-11-09", start_time: "08:00", end_time: "17:00" }
      expect do
        post "/api/v1/schedules", params: { schedule: attributes }, headers: headers
      end.not_to change(Schedule, :count)
      expect(response).to have_http_status(:unprocessable_entity)
      expect(JSON.parse(response.body).fetch("errors")).to include("User must reference an existing user")

      schedule = Schedule.create!(user: employee, work_date: "2026-11-08", start_time: Time.utc(2000, 1, 1, 8), end_time: Time.utc(2000, 1, 1, 17), created_by: admin)
      expect do
        patch "/api/v1/schedules/#{schedule.id}", params: { schedule: { user_id: invalid_user_id } }, headers: headers
      end.not_to change { schedule.reload.user_id }
      expect(response).to have_http_status(:unprocessable_entity)
      expect(JSON.parse(response.body).fetch("errors")).to include("User must reference an existing user")

      expect do
        post "/api/v1/schedules/bulk_create", params: { schedules: [ attributes.merge(user_id: employee.id), attributes ] }, headers: headers
      end.not_to change(Schedule, :count)
      expect(response).to have_http_status(:unprocessable_entity)
      expect(JSON.parse(response.body).fetch("details").first.fetch("errors")).to include("User must reference an existing user")
    end
  end

  it "preloads approved leave once for upcoming schedules while retaining exact conflict flags" do
    travel_to Time.zone.local(2026, 11, 1, 12) do
      (1..14).each do |day|
        Schedule.create!(user: employee, work_date: Date.new(2026, 11, day), start_time: Time.utc(2000, 1, 1, 8), end_time: Time.utc(2000, 1, 1, 17), created_by: admin)
      end
      create(:leave_request, user: employee, status: "approved", start_date: "2026-11-07", end_date: "2026-11-09", reason: "Private health detail")
      create(:leave_request, user: create(:user, :employee), status: "approved", start_date: "2026-11-01", end_date: "2026-11-14")
      queries = []
      subscriber = ->(_name, _started, _finished, _id, payload) { queries << payload[:sql] if payload[:sql].match?(/SELECT.*FROM "leave_requests"/i) && !payload[:cached] }
      ActiveSupport::Notifications.subscribed(subscriber, "sql.active_record") do
        get "/api/v1/schedules/my_schedule", headers: { "Authorization" => "Bearer test_token_#{employee.id}" }
      end
      expect(response).to have_http_status(:ok)
      schedules = JSON.parse(response.body).fetch("schedules")
      expect(schedules.length).to eq(14)
      expect(schedules.select { |row| row.fetch("approved_leave_conflict") }.map { |row| row.fetch("work_date") }).to eq(%w[2026-11-07 2026-11-08 2026-11-09])
      expect(queries.length).to eq(1)
      expect(response.body).not_to include("Private health detail")
    end
  end

  it "rechecks edits after leave approval and rejects a stale acknowledged leave identity" do
    schedule = Schedule.create!(user: employee, work_date: "2026-11-08", start_time: Time.utc(2000, 1, 1, 8), end_time: Time.utc(2000, 1, 1, 17), created_by: admin)
    leave = create(:leave_request, user: employee, status: "approved", start_date: "2026-11-08", end_date: "2026-11-08")
    get "/api/v1/schedules/#{schedule.id}", headers: headers
    expect(JSON.parse(response.body).dig("schedule", "approved_leave_conflict")).to be(true)
    expect do
      patch "/api/v1/schedules/#{schedule.id}", params: { schedule: { end_time: "16:00", acknowledge_leave_conflict: true, acknowledged_leave_ids: [ leave.id + 1 ], leave_conflict_reason: "Confirmed" } }, headers: headers
    end.not_to change { schedule.reload.end_time }
    expect(response).to have_http_status(:unprocessable_entity)
    patch "/api/v1/schedules/#{schedule.id}", params: { schedule: { end_time: "16:00", acknowledge_leave_conflict: true, acknowledged_leave_ids: [ leave.id ], leave_conflict_reason: "Confirmed revised hours with scheduler" } }, headers: headers
    expect(response).to have_http_status(:ok)
    expect(schedule.reload.hours).to eq(8)
    expect(leave.reload.status).to eq("approved")
    expect(AuditLog.where(action: "schedule.leave_conflict_acknowledged").count).to eq(1)
  end

  it "rolls back an entire bulk request and its conflict audit when any row needs acknowledgement" do
    leave = create(:leave_request, user: employee, status: "approved", start_date: "2026-11-08", end_date: "2026-11-08")
    rows = [
      { user_id: employee.id, work_date: "2026-11-08", start_time: "08:00", end_time: "17:00", acknowledge_leave_conflict: true, acknowledged_leave_ids: [ leave.id ], leave_conflict_reason: "Confirmed first shift" },
      { user_id: employee.id, work_date: "2026-11-08", start_time: "18:00", end_time: "19:00" }
    ]
    expect do
      post "/api/v1/schedules/bulk_create", params: { schedules: rows }, headers: headers
    end.not_to change(Schedule, :count)
    expect(response).to have_http_status(:unprocessable_entity)
    expect(AuditLog.where(action: "schedule.leave_conflict_acknowledged")).to be_empty
    expect(AuditLog.where(action: "schedules.bulk_create", outcome: "failed").count).to eq(1)
    expect(leave.reload.status).to eq("approved")
  end
end
