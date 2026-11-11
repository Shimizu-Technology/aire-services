# frozen_string_literal: true

require "rails_helper"
require_relative "../../../support/review_batch_helpers"

RSpec.describe "Undoing a review batch", type: :request do
  include ActiveSupport::Testing::TimeHelpers
  include ReviewBatchHelpers

  let(:review_category) { create(:time_category) }
  let(:owner) { create(:user, :owner) }
  let(:admin) { create(:user, :admin, first_name: "Chels") }
  let(:manager) { create(:user, :manager, first_name: "Roke", last_name: "Aguon") }
  let(:other_manager) { create(:user, :manager, first_name: "Mindy") }
  let(:employee) { create(:user, :employee, first_name: "Marcus", last_name: "Quinata") }
  let(:ethan) { create(:user, :employee, first_name: "Ethan", last_name: "Cruz") }
  let(:wednesday) { Date.new(2026, 4, 8) }

  around { |example| travel_to(ReviewBatchHelpers::ZONE.local(2026, 4, 10, 18)) { example.run } }

  def json = response.parsed_body

  def approve(entries, by: manager, **item_options)
    post_review_batch(by, entries.map { |entry| item_for(entry, **item_options) }, mode: item_options.empty? ? nil : "reviewed")
    expect(response).to have_http_status(:created)
    json["review_batch_id"]
  end

  def undo(batch_id, by: manager, entry_ids: nil)
    params = entry_ids ? { entry_ids: entry_ids } : {}
    post "/api/v1/time_entries/review_batches/#{batch_id}/undo", params: params, headers: headers_for(by), as: :json
  end

  it "moves the shifts back to waiting exactly as they were, with an audit row per shift" do
    shifts = [ clock_shift(employee, wednesday), clock_shift(employee, Date.new(2026, 4, 9)) ]
    batch_id = approve(shifts)

    undo(batch_id)

    expect(response).to have_http_status(:ok)
    expect(json).to include("review_batch_id" => batch_id, "undone_count" => 2)
    shifts.each do |shift|
      expect(shift.reload).to have_attributes(approval_status: "pending", approved_by_id: nil, approved_at: nil,
        approval_note: TimeClockService::UNSCHEDULED_NOTE)
    end
    rows = AuditLog.where(action: "time_entry.approval_undone").order(:auditable_id)
    expect(rows.map(&:auditable_id)).to eq(shifts.map(&:id))
    expect(rows.map { |row| row.metadata["review_batch_id"] }).to eq([ batch_id ] * 2)
    expect(AuditLogPresenter.new(rows.first).summary).to eq("Roke Aguon moved Marcus Quinata's time for Apr 8, 2026 back to waiting (undid an approval)")
    summary = AuditLog.find_by!(action: "review_batch.undone")
    expect(AuditLogPresenter.new(summary).summary).to eq("Roke Aguon undid the approval of 2 shifts for Marcus Quinata (moved back to waiting)")
    expect(ReviewBatch.find_by!(public_id: batch_id).undone_at).to be_present
    # Back in the ordinary list, as before the approval.
    expect(Approvals::ReviewClassifier.call(shifts.map(&:reload), viewer: manager).values.map { |row| row[:review_kind] }).to eq(%w[ordinary ordinary])

    undo(batch_id)
    expect(response).to have_http_status(:conflict)
    expect(json["code"]).to eq("already_undone")
  end

  it "reverts both the time and the overtime when the batch approved overtime" do
    [ 5, 6, 7 ].each { |day| clock_shift(ethan, Date.new(2026, 4, day), from: 6, hours: 12, approval_status: "approved") }
    shift = clock_shift(ethan, wednesday, overtime_status: "pending")
    batch_id = approve([ shift ], approve_overtime: true, overtime_hours: 4.0)
    expect(shift.reload).to have_attributes(approval_status: "approved", overtime_status: "approved")

    undo(batch_id)

    expect(response).to have_http_status(:ok)
    expect(shift.reload).to have_attributes(approval_status: "pending", overtime_status: "pending",
      overtime_approved_by_id: nil, overtime_approved_at: nil, approved_by_id: nil)
    expect(AuditLog.find_by!(action: "time_entry.approval_undone").metadata).to include("overtime_reverted" => true)
  end

  it "is allowed for an owner or admin but not another manager or an employee" do
    shifts = 3.times.map { |index| clock_shift(create(:user, :employee), wednesday, from: 6 + index) }
    batch_ids = shifts.map { |shift| approve([ shift ]) }

    undo(batch_ids[0], by: other_manager)
    expect(response).to have_http_status(:forbidden)
    expect(json["code"]).to eq("undo_forbidden")
    undo(batch_ids[0], by: employee)
    expect(response).to have_http_status(:forbidden)
    expect(shifts[0].reload.approval_status).to eq("approved")

    undo(batch_ids[1], by: admin)
    expect(response).to have_http_status(:ok)
    undo(batch_ids[2], by: owner)
    expect(response).to have_http_status(:ok)
    expect(shifts.map { |shift| shift.reload.approval_status }).to eq(%w[approved pending pending])
  end

  it "is refused after 15 minutes" do
    shift = clock_shift(employee, wednesday)
    batch_id = approve([ shift ])
    travel 15.minutes + 1.second

    undo(batch_id)

    expect(response).to have_http_status(:conflict)
    expect(json["code"]).to eq("undo_expired")
    expect(shift.reload.approval_status).to eq("approved")
  end

  it "is refused, for the whole batch, when a shift was edited after the approval" do
    shifts = [ clock_shift(employee, wednesday), clock_shift(ethan, wednesday) ]
    batch_id = approve(shifts)
    shifts.last.reload.update!(description: "Fixed the work description")

    undo(batch_id)

    expect(response).to have_http_status(:conflict)
    expect(json).to include("code" => "undo_refused", "blocked" => [ { "id" => shifts.last.id, "work_date" => "2026-04-08", "reason" => "changed" } ])
    expect(json["error"]).to eq("Can't undo 1 of 2: Wed, Apr 8 changed after it was approved. Nothing was moved back. Ask an admin to correct it in Timecards.")
    expect(shifts.map { |shift| shift.reload.approval_status }).to eq(%w[approved approved])
    expect(AuditLog.where(action: "time_entry.approval_undone")).to be_empty

    # The untouched shift can still be moved back on its own.
    undo(batch_id, entry_ids: [ shifts.first.id ])
    expect(response).to have_http_status(:ok)
    expect(shifts.map { |shift| shift.reload.approval_status }).to eq(%w[pending approved])
  end

  it "is refused once the pay period has locked" do
    create(:payroll_calendar_period, start_date: Date.new(2026, 4, 1), end_date: Date.new(2026, 4, 15), pay_date: Date.new(2026, 4, 20),
      cutoff_at: ReviewBatchHelpers::ZONE.local(2026, 4, 13, 17))
    shift = clock_shift(employee, wednesday)
    travel_to(ReviewBatchHelpers::ZONE.local(2026, 4, 13, 16, 55))
    batch_id = approve([ shift ])
    travel 6.minutes

    undo(batch_id)

    expect(response).to have_http_status(:conflict)
    expect(json).to include("code" => "undo_refused", "blocked" => [ { "id" => shift.id, "work_date" => "2026-04-08", "reason" => "locked" } ])
    expect(json["error"]).to start_with("Can't undo this approval: Wed, Apr 8 is already locked for payroll.")
    expect(shift.reload.approval_status).to eq("approved")
  end

  it "invalidates exports when it approves and again when it undoes" do
    shift = clock_shift(employee, wednesday)
    before_approval = protecting_export_for(shift)
    batch_id = approve([ shift ])
    expect(before_approval.reload.state).to eq("stale")

    after_approval = protecting_export_for(shift.reload)
    undo(batch_id)
    expect(response).to have_http_status(:ok)
    expect(after_approval.reload).to have_attributes(state: "stale")
    expect(after_approval.stale_reason).to include("Approval undone from review batch #{batch_id}")
  end

  it "undoes one shift's latest approval from the single-shift form" do
    shifts = [ clock_shift(employee, wednesday), clock_shift(ethan, wednesday) ]
    batch_id = approve(shifts)

    post "/api/v1/time_entries/#{shifts.first.id}/undo_approval", headers: headers_for(manager), as: :json

    expect(response).to have_http_status(:ok)
    expect(json).to include("review_batch_id" => batch_id, "undone_count" => 1)
    expect(shifts.map { |shift| shift.reload.approval_status }).to eq(%w[pending approved])
    expect(ReviewBatch.find_by!(public_id: batch_id).undone_at).to be_nil

    post "/api/v1/time_entries/#{shifts.first.id}/undo_approval", headers: headers_for(manager), as: :json
    expect(response).to have_http_status(:not_found)
  end

  it "returns 404 for an unknown batch" do
    undo(SecureRandom.uuid)
    expect(response).to have_http_status(:not_found)
  end
end
