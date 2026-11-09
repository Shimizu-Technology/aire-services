# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Approval cutoff display context", type: :request do
  include ActiveSupport::Testing::TimeHelpers

  let(:admin) { create(:user, :admin) }
  let(:employee) { create(:user, :employee) }
  let(:period) { create(:payroll_calendar_period) }
  let(:category) { create(:time_category) }
  let(:headers) { { "Authorization" => "Bearer test_token_#{admin.id}" } }

  def pending_entry(date)
    create(:time_entry, user: employee, time_category: category, work_date: date,
      status: "completed", entry_method: "manual", approval_status: "pending", overtime_status: "none")
  end

  describe "one-step approval" do
    def post_approve(entry, params = {})
      post "/api/v1/time_entries/#{entry.id}/approve", params: params, headers: headers, as: :json
    end

    let(:entry) do
      create(:time_entry, user: employee, time_category: category, work_date: period.start_date, status: "completed",
        entry_method: "manual", approval_status: "pending", overtime_status: "pending")
    end

    it "approves the time and its overtime together when asked" do
      post_approve(entry, include_overtime: true)

      expect(response).to have_http_status(:ok)
      expect(entry.reload).to have_attributes(approval_status: "approved", overtime_status: "approved", overtime_approved_by_id: admin.id, approved_by_id: admin.id)
    end

    it "leaves overtime waiting when only the time is approved" do
      post_approve(entry)

      expect(entry.reload).to have_attributes(approval_status: "approved", overtime_status: "pending")
    end

    it "does not approve overtime that only appeared when the time was approved" do
      entry.update_columns(overtime_status: "none")
      allow(TimeClockService).to receive(:approve_entry).and_wrap_original do |original, **args|
        original.call(**args).tap { |approved| approved.update_columns(overtime_status: "pending") }
      end

      post_approve(entry, include_overtime: true)

      expect(entry.reload).to have_attributes(approval_status: "approved", overtime_status: "pending")
    end

    it "approves nothing if the overtime step fails" do
      allow(TimeClockService).to receive(:approve_overtime).and_raise(TimeClockService::ClockError, "Confirm worked time")

      post_approve(entry, include_overtime: true)

      expect(response).to have_http_status(:unprocessable_entity)
      expect(entry.reload).to have_attributes(approval_status: "pending", overtime_status: "pending")
    end

    it "shows the overtime hours waiting on an entry in the queue" do
      allow(Payroll::AffectedOvertimeReview).to receive(:allocations_for).and_return({ entry.id => { regular_hours: 7.0, overtime_hours: 1.14 } })

      get "/api/v1/time_entries/pending_approvals", headers: headers

      row = response.parsed_body.fetch("pending_entries").find { |candidate| candidate.fetch("id") == entry.id }
      expect(row.fetch("pending_overtime_hours")).to eq(1.14)
    end
  end

  it "marks only entries in a published scheduled period once its cutoff is reached" do
    late = pending_entry(period.start_date)
    current = pending_entry(period.end_date + 1.day)
    [ -1.second, 0.seconds, 4.days ].each do |offset|
      travel_to(period.cutoff_at + offset) do
        get "/api/v1/time_entries/pending_approvals", headers: headers
        expect(response).to have_http_status(:ok)
        rows = response.parsed_body.fetch("pending_entries").index_by { |entry| entry.fetch("id") }
        expect(rows.fetch(late.id).fetch("payroll_cutoff_missed")).to eq(offset >= 0)
        expect(rows.fetch(current.id).fetch("payroll_cutoff_missed")).to be(false)
      end
    end
    expect(late.reload.approval_status).to eq("pending")
  end

  it "does not block or change a late approval and returns fresh cutoff context" do
    source = pending_entry(period.start_date)
    travel_to(period.cutoff_at + 1.second) do
      post "/api/v1/time_entries/#{source.id}/approve", headers: headers
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body.fetch("time_entry")).to include("approval_status" => "approved", "payroll_cutoff_missed" => true)
    end
    expect(source.reload.approved_by).to eq(admin)
  end

  it "does not change bulk approval and annotates each approved entry separately" do
    late = pending_entry(period.start_date)
    current = pending_entry(period.end_date + 1.day)
    travel_to(period.cutoff_at + 1.second) do
      post "/api/v1/time_entries/bulk_approve", params: { entry_ids: [ late.id, current.id ] }, headers: headers
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body.fetch("time_entries").map { |row| [ row.fetch("id"), row.fetch("payroll_cutoff_missed") ] }).to contain_exactly([ late.id, true ], [ current.id, false ])
    end
  end

  it "does not warn while paused" do
    source = pending_entry(period.start_date)
    previous = ENV["CONNECTED_PAYROLL_MODE"]
    ENV["CONNECTED_PAYROLL_MODE"] = "paused"
    travel_to(period.cutoff_at + 1.day) do
      expect(Payroll::EntryCutoffWarnings.call([ source ])).to be_empty
    end
  ensure
    ENV["CONNECTED_PAYROLL_MODE"] = previous
  end

  it "uses the actual manual lock instant, not the nominal scheduled cutoff" do
    manual = build(:payroll_calendar_period, lock_mode: "manual")
    manual.cutoff_enforcement_starts_on = manual.start_date.next_month.beginning_of_month
    manual.save!
    source = pending_entry(manual.start_date)
    travel_to(manual.cutoff_at + 2.days) do
      expect(Payroll::EntryCutoffWarnings.call([ source ])).to be_empty
      locked_at = Time.current + 1.hour
      batch = create(:payroll_batch, start_date: manual.start_date, end_date: manual.end_date,
        cutoff_at: locked_at, finalized_at: locked_at, finalized_by: admin)
      AuditLog.record!(action: "payroll_batch.finalized", actor: admin, source: "system", event_category: "payroll",
        auditable: batch, metadata: { manual_calendar_lock: true, automated_cutoff: false, calendar_lock_reason: "Synthetic manual lock fixture" })
      manual.update!(status: "finalized", payroll_batch: batch, finalized_at: locked_at)
      expect(Payroll::EntryCutoffWarnings.call([ source ])).to be_empty
      travel_to(locked_at)
      expect(Payroll::EntryCutoffWarnings.call([ source ])).to eq([ source.id ].to_set)
    end
  end

  it "bulk-reads calendar context with no per-entry queries or writes" do
    sources = Array.new(12) { pending_entry(period.start_date) }
    statements = []
    recorder = ->(_name, _start, _finish, _id, payload) { statements << payload[:sql] unless payload[:name] == "SCHEMA" }
    travel_to(period.cutoff_at + 1.second) do
      ActiveRecord::Base.uncached do
        ActiveSupport::Notifications.subscribed(recorder, "sql.active_record") do
          expect(Payroll::EntryCutoffWarnings.call(sources)).to eq(sources.map(&:id).to_set)
        end
      end
    end
    expect(statements.grep(/FROM "payroll_calendar_periods"/).size).to eq(1)
    expect(statements.grep(/\A\s*(INSERT|UPDATE|DELETE)\b/i)).to be_empty
  end
end
