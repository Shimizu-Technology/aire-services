# frozen_string_literal: true

require "rails_helper"
require_relative "../../../support/review_batch_helpers"

RSpec.describe "GET /api/v1/time_entries/:id/review_history", type: :request do
  include ReviewBatchHelpers
  let(:review_category) { create(:time_category) }
  let(:worker) { create(:user, :employee, first_name: "Ethan", last_name: "Cruz") }
  let(:manager) { create(:user, :manager, first_name: "Roke", last_name: "Aguon") }
  let!(:entry) { clock_shift(worker, Date.new(2026, 11, 10)) }

  def history(viewer)
    get "/api/v1/time_entries/#{entry.id}/review_history", headers: headers_for(viewer)
  end

  def record(action = "time_entry.updated", **options)
    AuditLog.record!(action: action, auditable: entry, actor: manager, **options)
  end

  %i[owner admin manager].each do |role|
    it "allows an #{role} who can review the entry" do
      history(create(:user, role))
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to include("entry_id" => entry.id, "changes" => [])
    end
  end

  it "allows managers across departments, just like approval actions" do
    Setting.set_approval_groups!([ { key: "cfi", label: "CFI" }, { key: "ops", label: "Ops/Maint" } ])
    manager.user_approval_groups.create!(approval_group: "cfi")
    worker.user_approval_groups.create!(approval_group: "ops")
    history(manager)
    expect(response).to have_http_status(:ok)
  end

  it "returns 404 for own time when another approver is required" do
    # Department is a filter, not an authorization boundary. This is the
    # reachable manager refusal in can_review_time_of? instead.
    Setting.set(Setting::MANAGERS_CAN_APPROVE_OWN_TIME_KEY, "false")
    own = clock_shift(manager, Date.new(2026, 11, 10))
    get "/api/v1/time_entries/#{own.id}/review_history", headers: headers_for(manager)
    expect(response).to have_http_status(:not_found)
    expect(response.parsed_body).not_to have_key("changes")
  end

  it "forbids employees" do
    history(worker)
    expect(response).to have_http_status(:forbidden)
  end

  it "requires sign-in" do
    get "/api/v1/time_entries/#{entry.id}/review_history"
    expect(response).to have_http_status(:unauthorized)
  end

  it "returns edited values, actor, timestamp and reason" do
    audit = record(changes: { hours: { from: 7, to: 8 }, description: { from: "Before", to: "After" } }, metadata: { correction_reason: "Missed hour" })
    history(manager)
    change = response.parsed_body.fetch("changes").first
    expect(change).to include("actor" => { "id" => manager.id, "full_name" => "Roke Aguon" }, "reason" => "Missed hour")
    expect(change["at"]).to eq(audit.occurred_at.in_time_zone("Pacific/Guam").iso8601)
    expect(change["fields"]).to include({ "field" => "hours", "label" => "Hours", "before" => 7, "after" => 8 })
    expect(change["sentence"]).to include("Roke Aguon", "edited")
  end

  it "formats a corrected clock-out in Guam time" do
    record("time_entry.clock_ended", changes: { clock_out_at: { from: nil, to: "2026-11-10T06:00:00Z" } }, metadata: { correction_reason: "Forgot to clock out" })
    history(manager)
    change = response.parsed_body.fetch("changes").first
    expect(change["fields"]).to eq([ { "field" => "clock_out_at", "label" => "Clock out", "before" => nil, "after" => "Nov 10, 2026 4:00 PM" } ])
    expect(change["reason"]).to eq("Forgot to clock out")
  end

  it "identifies who added a manual shift without fabricating values" do
    entry.update!(entry_method: "manual")
    record("time_entry.created", metadata: { hours: 8, work_date: entry.work_date.iso8601 })
    history(manager)
    change = response.parsed_body.fetch("changes").first
    expect(change["actor"]).to include("full_name" => "Roke Aguon")
    expect(change["sentence"]).to include("added", "Ethan Cruz")
    expect(change["fields"]).to eq([])
  end

  it "drops non-allowlisted fields, nested values, and unrelated metadata" do
    record(changes: { hours: { from: 7, to: 8 }, pay_rate: { from: 100, to: 200 }, break_minutes: { from: { other_user: "Private" }, to: 30 } },
      metadata: { salary: "Private", employee_name: "Wrong person", unrelated: { name: "Secret" } })
    other = clock_shift(create(:user, :employee), Date.new(2026, 11, 10))
    AuditLog.record!(action: "time_entry.updated", auditable: other, actor: manager, metadata: { correction_reason: "Unrelated reason" })
    history(manager)
    expect(response.parsed_body.to_json).not_to include("pay_rate", "Private", "Wrong person", "Secret", "Unrelated reason")
    expect(response.parsed_body["changes"].size).to eq(1)
    expect(response.parsed_body["changes"].first["fields"].last["before"]).to be_nil
  end

  it "includes break events audited against the shift, newest first, capped at 20" do
    22.times { |index| record("time_entry.break_ended", occurred_at: Time.current + index.seconds) }
    history(manager)
    changes = response.parsed_body.fetch("changes")
    expect(changes.size).to eq(20)
    expect(changes.map { |change| change["at"] }).to eq(changes.map { |change| change["at"] }.sort.reverse)
  end
end
