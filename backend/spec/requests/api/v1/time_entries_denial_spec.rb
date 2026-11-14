# frozen_string_literal: true

require "rails_helper"
require_relative "../../../support/review_batch_helpers"

RSpec.describe "Denying a shift in the Approvals inbox", type: :request do
  include ReviewBatchHelpers

  let(:review_category) { create(:time_category) }
  let(:manager) { create(:user, :manager) }
  let(:employee) { create(:user, :employee) }
  let(:monday) { Date.new(2026, 4, 6) }

  it "closes pending overtime with the time denial and audits both decisions" do
    entry = clock_shift(employee, monday, overtime_status: "pending")
    post "/api/v1/time_entries/#{entry.id}/deny", params: { note: "Please correct the punches." }, headers: headers_for(manager), as: :json

    expect(response).to have_http_status(:ok)
    expect(entry.reload.approval_status).to eq("denied")
    expect(entry.overtime_status).to be_in(%w[denied none])
    expect(entry.overtime_approved_by).to eq(manager)
    expect(entry.overtime_approved_at).to be_within(1.second).of(Time.current)
    expect(entry.overtime_note).to eq("Please correct the punches.")
    expect(entry.approval_note).to eq("Please correct the punches.")
    expect(AuditLog.where(auditable: entry, user: manager).pluck(:action)).to include("time_entry.denied", "time_entry.overtime_denied")
    get "/api/v1/time_entries/pending_approvals", headers: headers_for(manager)
    expect(response.parsed_body.fetch("pending_entries").pluck("id")).not_to include(entry.id)
    expect(response.parsed_body.fetch("count")).to eq(0)
  end

  it "excludes legacy denied shifts whose overtime was left pending" do
    entry = clock_shift(employee, monday)
    entry.update_columns(approval_status: "denied", overtime_status: "pending")
    get "/api/v1/time_entries/pending_approvals", headers: headers_for(manager)
    expect(response.parsed_body.fetch("pending_entries")).to be_empty
  end

  it "does not label review decisions as edits and reconciles the remaining week" do
    shifts = (0..4).map { |day| clock_shift(employee, monday + day, hours: 9) }
    first = shifts.first
    projected = Payroll::AffectedOvertimeReview.projected_allocations_for(shifts)
    expect(projected.fetch(shifts.last.id).fetch(:overtime_hours)).to eq(5)
    expect(Payroll::AffectedOvertimeReview).to receive(:reconcile).and_call_original
    post "/api/v1/time_entries/#{first.id}/deny", params: { note: "Duplicate shift" }, headers: headers_for(manager), as: :json
    expect(response).to have_http_status(:ok)
    projected = Payroll::AffectedOvertimeReview.projected_allocations_for(shifts.map(&:reload))
    expect(projected.fetch(shifts.last.id).fetch(:overtime_hours)).to eq(0)
    reasons = Approvals::ReviewClassifier.call([ first.reload ], viewer: manager).fetch(first.id).fetch(:exceptions)
    expect(reasons.pluck(:key)).not_to include("edited")
  end

  it "rolls back the time and overtime decision together if auditing fails" do
    entry = clock_shift(employee, monday, overtime_status: "pending")
    allow(TimeClockService).to receive(:record_review_event!).and_raise(ActiveRecord::RecordInvalid)
    expect do
      TimeClockService.deny_entry(entry: entry, denied_by: manager, note: "Duplicate")
    end.to raise_error(ActiveRecord::RecordInvalid)
    expect(entry.reload.attributes.slice("approval_status", "overtime_status")).to eq("approval_status" => "pending", "overtime_status" => "pending")
    expect(AuditLog.where(auditable: entry)).to be_empty
  end
end

RSpec.describe "Approvals ordinary shift limit", type: :request do
  it "returns the actual configured rule limit to the inbox" do
    manager = create(:user, :manager)
    Setting.set("auto_approve_max_shift_hours", "10")
    get "/api/v1/time_entries/pending_approvals", headers: { "Authorization" => "Bearer test_token_#{manager.id}" }
    expect(response.parsed_body.dig("review_summary", "ordinary_max_shift_hours")).to eq(10)
  end
end

RSpec.describe "Legacy pending overtime in the inbox", type: :request do
  it "retains overtime waiting on a legacy entry with no explicit time approval status" do
    manager = create(:user, :manager)
    entry = create(:time_entry, approval_status: nil, overtime_status: "pending")
    get "/api/v1/time_entries/pending_approvals", headers: { "Authorization" => "Bearer test_token_#{manager.id}" }
    expect(response.parsed_body.fetch("pending_entries").pluck("id")).to include(entry.id)
  end
end
