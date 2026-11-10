# frozen_string_literal: true

require "rails_helper"

# Every path a manager could use to approve, deny, override or correct their own
# time, with "Managers can approve their own time" on (the default) and off.
RSpec.describe "Manager self-approval setting", type: :request do
  let(:category) { create(:time_category) }
  let(:manager) { create(:user, :manager, time_tracking_enabled: true, kiosk_enabled: true) }
  let(:other_manager) { create(:user, :manager, first_name: "Mindy") }
  let(:admin) { create(:user, :admin) }
  let(:owner) { create(:user, :owner) }
  let(:employee) { create(:user, :employee, first_name: "Ana") }

  def headers_for(user)
    { "Authorization" => "Bearer test_token_#{user.id}" }
  end

  def json
    response.parsed_body
  end

  def pending_entry_for(user, **attrs)
    create(:time_entry, user: user, time_category: category, approval_status: "pending", **attrs)
  end

  def turn_off!
    Setting.set(Setting::MANAGERS_CAN_APPROVE_OWN_TIME_KEY, "false")
  end

  before do
    [ manager, employee ].each { |user| user.user_time_categories.create!(time_category: category) }
  end

  context "when on (the default)" do
    it "keeps today's behavior: a manager approves their own time and overtime" do
      entry = pending_entry_for(manager)
      post "/api/v1/time_entries/#{entry.id}/approve", headers: headers_for(manager)
      expect(response).to have_http_status(:ok)
      expect(json.dig("time_entry", "needs_another_approver")).to be(false)
      expect(entry.reload.approved_by).to eq(manager)

      overtime = pending_entry_for(manager, approval_status: "approved", overtime_status: "pending")
      post "/api/v1/time_entries/#{overtime.id}/approve_overtime", headers: headers_for(manager)
      expect(response).to have_http_status(:ok)

      bulk = pending_entry_for(manager)
      post "/api/v1/time_entries/bulk_approve", params: { entry_ids: [ bulk.id ] }, headers: headers_for(manager)
      expect(response).to have_http_status(:ok)
      expect(bulk.reload.approval_status).to eq("approved")
    end

    it "lets a manager clock themselves in with an override and skip the queue" do
      post "/api/v1/time_entries/clock_in", params: { admin_override: true, time_category_id: category.id }, headers: headers_for(manager)
      expect(response).to have_http_status(:created)
      post "/api/v1/time_entries/clock_out", headers: headers_for(manager)
      expect(response).to have_http_status(:ok)
      expect(json.dig("time_entry", "approval_status")).to be_nil
    end
  end

  context "when off" do
    before { turn_off! }

    it "refuses a manager's approve, deny, overtime and one-button approvals on their own time" do
      entry = pending_entry_for(manager, overtime_status: "pending")

      [
        [ "approve", {} ],
        [ "approve", { include_overtime: true } ],
        [ "deny", { note: "Wrong day" } ],
        [ "approve_overtime", {} ],
        [ "deny_overtime", { note: "Not authorized" } ]
      ].each do |action, params|
        post "/api/v1/time_entries/#{entry.id}/#{action}", params: params, headers: headers_for(manager)
        expect(response).to have_http_status(:forbidden), "#{action} #{params}"
        expect(json["error"]).to eq(TimeClockService::OWN_TIME_REVIEW_MESSAGE)
      end

      expect(entry.reload).to have_attributes(approval_status: "pending", overtime_status: "pending", approved_by_id: nil)
    end

    it "refuses a bulk approval that includes the manager's own entry and approves nothing" do
      own = pending_entry_for(manager)
      theirs = pending_entry_for(employee)

      post "/api/v1/time_entries/bulk_approve", params: { entry_ids: [ theirs.id, own.id ] }, headers: headers_for(manager)

      expect(response).to have_http_status(:forbidden)
      expect(json["error"]).to include(TimeClockService::OWN_TIME_REVIEW_MESSAGE)
      expect([ own.reload.approval_status, theirs.reload.approval_status ]).to eq(%w[pending pending])
    end

    it "still lets the manager approve other people's time" do
      theirs = pending_entry_for(employee)
      post "/api/v1/time_entries/bulk_approve", params: { entry_ids: [ theirs.id ] }, headers: headers_for(manager)

      expect(response).to have_http_status(:ok)
      expect(theirs.reload.approved_by).to eq(manager)
    end

    it "lets owners, admins and other managers approve the manager's time" do
      [ owner, admin, other_manager ].each do |approver|
        entry = pending_entry_for(manager, overtime_status: "pending")
        post "/api/v1/time_entries/#{entry.id}/approve", params: { include_overtime: true }, headers: headers_for(approver)

        expect(response).to have_http_status(:ok), approver.role
        expect(entry.reload).to have_attributes(approval_status: "approved", overtime_status: "approved", approved_by_id: approver.id)
      end
    end

    it "refuses a manager's override of their own clock, from My Time or the team list" do
      post "/api/v1/time_entries/clock_in", params: { admin_override: true, time_category_id: category.id }, headers: headers_for(manager)
      expect(response).to have_http_status(:forbidden)
      expect(json["error"]).to eq(TimeClockService::OWN_CLOCK_OVERRIDE_MESSAGE)

      post "/api/v1/time_entries/clock_in", params: { user_id: manager.id, admin_override: true, time_category_id: category.id },
                                             headers: headers_for(manager)
      expect(response).to have_http_status(:forbidden)
      expect(manager.time_entries).to be_empty

      get "/api/v1/time_entries/current_status", headers: headers_for(manager)
      expect(json["can_override_clock"]).to be(false)
    end

    it "sends a manager's unscheduled clock to the queue, read-only for them and open to others" do
      post "/api/v1/time_entries/clock_in", params: { time_category_id: category.id }, headers: headers_for(manager)
      expect(response).to have_http_status(:created)
      post "/api/v1/time_entries/clock_out", headers: headers_for(manager)
      entry = manager.time_entries.last
      expect(entry).to have_attributes(approval_status: "pending", approval_note: "Clocked in without a schedule")

      get "/api/v1/time_entries/pending_approvals", headers: headers_for(manager)
      own_row = json.fetch("pending_entries").find { |row| row["id"] == entry.id }
      expect(own_row).to include("needs_another_approver" => true)

      get "/api/v1/time_entries/pending_approvals", headers: headers_for(admin)
      expect(json.fetch("pending_entries").find { |row| row["id"] == entry.id }).to include("needs_another_approver" => false)

      get "/api/v1/time_entries/pending_approvals", headers: headers_for(other_manager)
      expect(json.fetch("pending_entries").find { |row| row["id"] == entry.id }).to include("needs_another_approver" => false)
    end

    it "treats a manager's edit of their own approved time like an employee edit" do
      entry = create(:time_entry, user: manager, time_category: category, approval_status: "approved", approved_by: admin)

      patch "/api/v1/time_entries/#{entry.id}", params: { time_entry: { description: "Fixed note" } }, headers: headers_for(manager)

      expect(response).to have_http_status(:ok)
      expect(entry.reload).to have_attributes(approval_status: "pending", approved_by_id: nil)
      expect(entry.approval_note).to include("Employee edited")
    end

    it "refuses a manager's supervisor correction of their own clock" do
      entry = create(:time_entry, user: manager, time_category: category, entry_method: "clock", status: "clocked_in",
                                  start_time: 3.hours.ago, clock_in_at: 3.hours.ago, end_time: nil, hours: 0)

      patch "/api/v1/time_entries/#{entry.id}", headers: headers_for(manager),
            params: { correction_reason: "Forgot to clock out", time_entry: {
              review_action: "end_clock", expected_version: entry.lock_version, stop_date: entry.work_date.iso8601,
              end_time: "23:00", time_category_id: category.id
            } }

      expect(response).to have_http_status(:forbidden)
      expect(json["error"]).to eq(TimeEntryReviewCorrection::OWN_TIME_MESSAGE)
      expect(entry.reload.status).to eq("clocked_in")
    end

    it "leaves admins able to approve their own time" do
      entry = pending_entry_for(admin)
      post "/api/v1/time_entries/#{entry.id}/approve", headers: headers_for(admin)

      expect(response).to have_http_status(:ok)
      expect(json.dig("time_entry", "needs_another_approver")).to be(false)
    end
  end
end
