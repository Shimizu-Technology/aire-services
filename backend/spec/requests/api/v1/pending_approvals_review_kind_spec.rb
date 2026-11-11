# frozen_string_literal: true

require "rails_helper"
require_relative "../../../support/review_batch_helpers"

RSpec.describe "GET /api/v1/time_entries/pending_approvals review kinds", type: :request do
  include ActiveSupport::Testing::TimeHelpers
  include ReviewBatchHelpers

  let(:review_category) { create(:time_category) }
  let(:admin) { create(:user, :admin, first_name: "Chels") }
  let(:manager) { create(:user, :manager, first_name: "Roke", last_name: "Aguon") }
  let(:marcus) { create(:user, :employee, first_name: "Marcus", last_name: "Quinata") }
  let(:ethan) { create(:user, :employee, first_name: "Ethan", last_name: "Cruz") }
  let(:wednesday) { Date.new(2026, 4, 8) }

  around { |example| travel_to(ReviewBatchHelpers::ZONE.local(2026, 4, 10, 18)) { example.run } }

  def json = response.parsed_body

  def rows_by_id
    json["pending_entries"].index_by { |row| row["id"] }
  end

  let!(:ordinary) { [ clock_shift(marcus, wednesday), clock_shift(marcus, Date.new(2026, 4, 9)) ] }
  let!(:overtime) do
    [ 5, 6, 7 ].each { |day| clock_shift(ethan, Date.new(2026, 4, day), from: 6, hours: 12, approval_status: "approved") }
    clock_shift(ethan, wednesday, overtime_status: "pending")
  end
  let!(:own) { clock_shift(manager, wednesday, approval_note: "Clocked in without a schedule | Supervisor's own time") }

  it "labels each waiting shift ordinary or needs a look, with its reasons" do
    get "/api/v1/time_entries/pending_approvals", headers: headers_for(manager)

    expect(response).to have_http_status(:ok)
    ordinary.each { |entry| expect(rows_by_id.fetch(entry.id)).to include("review_kind" => "ordinary", "exceptions" => [], "version" => entry.reload.lock_version) }
    expect(rows_by_id.fetch(overtime.id)).to include("review_kind" => "needs_look", "exceptions" => [ { "key" => "overtime", "label" => "Overtime" } ])
    expect(rows_by_id.fetch(own.id)).to include("review_kind" => "needs_look", "exceptions" => [ { "key" => "own_time", "label" => "Your own time" } ])
  end

  it "summarises counts per kind and per person" do
    get "/api/v1/time_entries/pending_approvals", headers: headers_for(manager)

    expect(json["review_summary"]).to include("complete" => true, "ordinary_count" => 2, "ordinary_hours" => 16.0, "needs_look_count" => 2, "batch_limit" => 100)
    expect(json["review_summary"]["by_person"]).to eq([
      { "user_id" => ethan.id, "full_name" => "Ethan Cruz", "ordinary_count" => 0, "ordinary_hours" => 0.0, "needs_look_count" => 1 },
      { "user_id" => marcus.id, "full_name" => "Marcus Quinata", "ordinary_count" => 2, "ordinary_hours" => 16.0, "needs_look_count" => 0 },
      { "user_id" => manager.id, "full_name" => "Roke Aguon", "ordinary_count" => 0, "ordinary_hours" => 0.0, "needs_look_count" => 1 }
    ])
  end

  it "depends on who is looking" do
    Setting.set(Setting::MANAGERS_CAN_APPROVE_OWN_TIME_KEY, "false")
    get "/api/v1/time_entries/pending_approvals", headers: headers_for(manager)
    expect(rows_by_id.fetch(own.id)["exceptions"].map { |row| row["key"] }).to eq(%w[own_time needs_another_approver])

    get "/api/v1/time_entries/pending_approvals", headers: headers_for(admin)
    expect(rows_by_id.fetch(own.id)["exceptions"]).to eq([ { "key" => "supervisor_own_time", "label" => "Supervisor's own time" } ])
  end

  it "says the summary is partial when the list is paged" do
    get "/api/v1/time_entries/pending_approvals", params: { per_page: 2 }, headers: headers_for(manager)
    expect(json["review_summary"]["complete"]).to be(false)
  end
end
