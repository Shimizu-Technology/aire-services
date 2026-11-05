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
