# frozen_string_literal: true

require "rails_helper"
require_relative "../../../support/database_clock_helpers"
require_relative "../../../support/review_batch_helpers"

RSpec.describe "POST /api/v1/time_entries/review_batch", type: :request do
  include ActiveSupport::Testing::TimeHelpers
  include DatabaseClockHelpers
  include ReviewBatchHelpers

  let(:review_category) { create(:time_category) }
  let(:owner) { create(:user, :owner) }
  let(:admin) { create(:user, :admin, first_name: "Chels") }
  let(:manager) { create(:user, :manager, first_name: "Roke", last_name: "Aguon") }
  let(:employee) { create(:user, :employee, first_name: "Marcus", last_name: "Quinata") }
  let(:ethan) { create(:user, :employee, first_name: "Ethan", last_name: "Cruz") }
  let(:wednesday) { Date.new(2026, 4, 8) }

  # Undo reads the database clock, so it starts at the same instant.
  around { |example| with_shifted_database_clock(ReviewBatchHelpers::ZONE.local(2026, 4, 10, 18)) { example.run } }
  around { |example| travel_to(ReviewBatchHelpers::ZONE.local(2026, 4, 10, 18)) { example.run } }

  def json = response.parsed_body

  it "approves exactly the listed shifts for owners, admins and managers, and refuses employees" do
    { owner => :created, admin => :created, manager => :created }.each do |user, status|
      entries = [ clock_shift(create(:user, :employee), wednesday), clock_shift(create(:user, :employee), wednesday) ]
      waiting = clock_shift(create(:user, :employee), wednesday)
      post_review_batch(user, entries.map { |entry| item_for(entry) })
      expect(response).to have_http_status(status), user.role
      expect(entries.map { |entry| entry.reload.approval_status }).to eq(%w[approved approved])
      expect(entries.map(&:approved_by_id).uniq).to eq([ user.id ])
      expect(waiting.reload.approval_status).to eq("pending")
    end

    entry = clock_shift(ethan, wednesday)
    post_review_batch(employee, [ item_for(entry) ])
    expect(response).to have_http_status(:forbidden)
    expect(entry.reload.approval_status).to eq("pending")
    expect(ReviewBatch.where(actor: employee)).to be_empty
  end

  it "returns the batch, writes audit rows and records the versions after approval" do
    first = clock_shift(employee, wednesday)
    second = clock_shift(employee, Date.new(2026, 4, 9))
    post_review_batch(manager, [ item_for(first), item_for(second) ])

    expect(response).to have_http_status(:created)
    batch = ReviewBatch.find_by!(public_id: json["review_batch_id"])
    expect(json).to include("approved_count" => 2, "overtime_approved_count" => 0, "hours" => 16.0, "replayed" => false)
    expect(Time.iso8601(json["undo_expires_at"])).to be_within(1.second).of(batch.created_at + 15.minutes)
    expect(json["time_entries"]).to eq([ first, second ].map { |entry| entry.reload; { "id" => entry.id, "version" => entry.lock_version, "approval_status" => "approved", "overtime_status" => entry.overtime_status } })
    expect(batch.review_batch_items.order(:time_entry_id).pluck(:time_entry_id, :version_after)).to eq([ [ first.id, first.lock_version ], [ second.id, second.lock_version ] ])

    approvals = AuditLog.where(action: "time_entry.approved", auditable_id: [ first.id, second.id ])
    expect(approvals.map { |row| row.metadata["review_batch_id"] }).to eq([ batch.public_id ] * 2)
    summary = AuditLog.find_by!(action: "review_batch.approved", auditable_id: batch.id)
    expect(AuditLogPresenter.new(summary).summary).to eq("Roke Aguon approved 2 shifts for Marcus Quinata")
  end

  it "approves nothing when any version doesn't match, and lists the changed shifts" do
    unchanged = clock_shift(employee, wednesday)
    changed = clock_shift(ethan, wednesday)
    stale = item_for(changed)
    changed.update!(description: "Edited in another tab")

    post_review_batch(manager, [ item_for(unchanged), stale ])

    expect(response).to have_http_status(:conflict)
    expect(json).to include("code" => "stale_entries", "changed_ids" => [ changed.id ])
    expect(json["error"]).to eq("1 shift changed since you loaded this list. Nothing was approved.")
    expect([ unchanged.reload, changed.reload ].map(&:approval_status)).to eq(%w[pending pending])
    expect(ReviewBatch.count).to eq(0)
    expect(AuditLog.where(action: %w[time_entry.approved review_batch.approved])).to be_empty
  end

  it "treats a deleted or already-approved shift as changed" do
    approved = clock_shift(employee, wednesday)
    item = item_for(approved)
    TimeClockService.approve_entry(entry: approved, approved_by: admin)
    gone = clock_shift(ethan, wednesday)
    gone_item = item_for(gone)
    gone.destroy!

    post_review_batch(manager, [ item.merge(version: approved.reload.lock_version), gone_item ])
    expect(response).to have_http_status(:conflict)
    expect(json["changed_ids"]).to contain_exactly(approved.id, gone.id)
  end

  describe "overtime" do
    # Sunday through Tuesday, 12 hours each: 36 hours before Wednesday.
    def earlier_week(user, approval_status: "approved")
      [ 5, 6, 7 ].map { |day| clock_shift(user, Date.new(2026, 4, day), from: 6, hours: 12, approval_status: approval_status) }
    end

    it "doesn't approve overtime that appeared after the list loaded" do
      wednesday_shift = clock_shift(ethan, wednesday)
      shown = item_for(wednesday_shift)
      # Earlier shifts arrive and are approved after Roke loaded the list; the
      # Wednesday row itself is untouched.
      earlier_week(ethan)
      expect(wednesday_shift.reload.lock_version).to eq(shown[:version])

      post_review_batch(manager, [ shown ])
      expect(response).to have_http_status(:conflict)
      expect(json).to include("code" => "needs_look", "changed_ids" => [ wednesday_shift.id ])
      expect(wednesday_shift.reload.approval_status).to eq("pending")

      post_review_batch(manager, [ shown ], mode: "reviewed")
      expect(response).to have_http_status(:created)
      expect(wednesday_shift.reload).to have_attributes(approval_status: "approved", overtime_status: "pending", overtime_approved_by_id: nil)
      expect(AuditLog.where(action: "time_entry.overtime_approved", auditable_id: wednesday_shift.id)).to be_empty
    end

    it "approves overtime only on items that ask, with the hours that were shown" do
      earlier_week(ethan)
      wednesday_shift = clock_shift(ethan, wednesday, overtime_status: "pending")

      post_review_batch(manager, [ item_for(wednesday_shift, approve_overtime: true, overtime_hours: 3.5) ], mode: "reviewed")
      expect(response).to have_http_status(:conflict)
      expect(json).to include("code" => "stale_entries", "changed_ids" => [ wednesday_shift.id ])
      expect(wednesday_shift.reload.approval_status).to eq("pending")

      post_review_batch(manager, [ item_for(wednesday_shift, approve_overtime: true, overtime_hours: 4.0) ], mode: "reviewed")
      expect(response).to have_http_status(:created)
      expect(json["overtime_approved_count"]).to eq(1)
      expect(wednesday_shift.reload).to have_attributes(approval_status: "approved", overtime_status: "approved", overtime_approved_by_id: manager.id)
    end

    # 30 approved hours, then a 4h Monday (X) and a 12h Thursday (Y) waiting:
    # Y shows 6.0h of overtime once X counts, but only 2.0h before it does.
    def week_with_two_waiting(user)
      [ 5, 7, 8 ].each { |day| clock_shift(user, Date.new(2026, 4, day), hours: 10, approval_status: "approved") }
      monday = clock_shift(user, Date.new(2026, 4, 6), hours: 4)
      thursday = clock_shift(user, Date.new(2026, 4, 9), from: 6, hours: 12, overtime_status: "pending")
      [ monday, thursday ]
    end

    [ :thursday_first, :monday_first ].each do |order|
      it "keeps overtime approved whatever the item order (#{order})" do
        monday, thursday = week_with_two_waiting(ethan)
        items = [ item_for(thursday, approve_overtime: true, overtime_hours: 6.0), item_for(monday) ]
        items.reverse! if order == :monday_first

        post_review_batch(manager, items, mode: "reviewed")

        expect(response).to have_http_status(:created)
        expect(json["overtime_approved_count"]).to eq(1)
        expect(monday.reload.approval_status).to eq("approved")
        expect(thursday.reload).to have_attributes(approval_status: "approved", overtime_status: "approved", overtime_approved_by_id: manager.id)
        expect(json["time_entries"].find { |row| row["id"] == thursday.id }).to include("overtime_status" => "approved")
        expect(AuditLog.where(action: "time_entry.overtime_approved", auditable_id: thursday.id).count).to eq(1)
        expect(AuditLog.where(action: Approvals::OvertimeResetAudit::ACTION)).to be_empty
      end
    end

    it "approves nothing when the week's recalculation resets overtime the batch approved" do
      monday, thursday = week_with_two_waiting(ethan)
      allow(Payroll::AffectedOvertimeReview).to receive(:reconcile).and_wrap_original do |original, *args|
        original.call(*args)
        TimeEntry.where(id: thursday.id).update_all(overtime_status: "pending", overtime_approved_by_id: nil, overtime_approved_at: nil)
      end

      post_review_batch(manager, [ item_for(monday), item_for(thursday, approve_overtime: true, overtime_hours: 6.0) ], mode: "reviewed")

      expect(response).to have_http_status(:conflict)
      expect(json).to include("code" => "stale_entries", "changed_ids" => [ thursday.id ])
      expect([ monday.reload, thursday.reload ].map(&:approval_status)).to eq(%w[pending pending])
      expect(ReviewBatch.count).to eq(0)
      expect(AuditLog.where(action: %w[time_entry.approved time_entry.overtime_approved review_batch.approved])).to be_empty
    end

    it "audits another shift whose approved overtime the recalculation reset, on approve and on undo" do
      [ 5, 6, 7 ].each { |day| clock_shift(ethan, Date.new(2026, 4, day), hours: 12, approval_status: "approved") }
      thursday = clock_shift(ethan, Date.new(2026, 4, 9), approval_status: "approved", overtime_status: "pending")
      TimeClockService.approve_overtime(entry: thursday, approved_by: admin)
      expect(thursday.reload.overtime_status).to eq("approved")
      wednesday_shift = clock_shift(ethan, wednesday, hours: 4)

      post_review_batch(manager, [ item_for(wednesday_shift) ], mode: "reviewed")

      expect(response).to have_http_status(:created)
      expect(thursday.reload.overtime_status).to eq("pending")
      reset = AuditLog.find_by!(action: Approvals::OvertimeResetAudit::ACTION, auditable_id: thursday.id)
      expect(reset.metadata).to include("review_batch_id" => json["review_batch_id"], "reason" => "approved",
        "overtime_status" => "pending", "previous_overtime_approved_by_id" => admin.id)
      expect(AuditLogPresenter.new(reset).summary).to eq("Roke Aguon moved Ethan Cruz's approved overtime for Apr 9, 2026 back to waiting (the week's overtime changed)")

      # Approved again at the new hours, then the batch is undone: the week
      # shrinks back and that approval is reset too, with its own row.
      TimeClockService.approve_overtime(entry: thursday.reload, approved_by: admin)
      post "/api/v1/time_entries/review_batches/#{json['review_batch_id']}/undo", headers: headers_for(manager), as: :json
      expect(response).to have_http_status(:ok)
      expect(thursday.reload.overtime_status).to eq("pending")
      expect(AuditLog.where(action: Approvals::OvertimeResetAudit::ACTION, auditable_id: thursday.id).pluck(Arel.sql("metadata->>'reason'")))
        .to eq(%w[approved approval_undone])
      expect(AuditLog.where(action: Approvals::OvertimeResetAudit::ACTION, auditable_id: wednesday_shift.id)).to be_empty
    end

    it "requires the overtime hours with every overtime approval" do
      entry = clock_shift(ethan, wednesday, overtime_status: "pending")
      post_review_batch(manager, [ item_for(entry, approve_overtime: true) ], mode: "reviewed")
      expect(response).to have_http_status(:unprocessable_entity)
      expect(json["code"]).to eq("invalid_request")
    end
  end

  it "refuses a manager's own time when the policy is off, and approves nothing" do
    Setting.set(Setting::MANAGERS_CAN_APPROVE_OWN_TIME_KEY, "false")
    own = clock_shift(manager, wednesday, approval_note: "Clocked in without a schedule | Supervisor's own time")
    theirs = clock_shift(employee, wednesday)

    post_review_batch(manager, [ item_for(own), item_for(theirs) ], mode: "reviewed")

    expect(response).to have_http_status(:forbidden)
    expect(json["code"]).to eq("own_time")
    expect([ own.reload, theirs.reload ].map(&:approval_status)).to eq(%w[pending pending])
    expect(ReviewBatch.count).to eq(0)
  end

  describe "reviewed mode" do
    it "covers one person only" do
      entries = [ clock_shift(employee, wednesday), clock_shift(ethan, wednesday) ]
      post_review_batch(manager, entries.map { |entry| item_for(entry) }, mode: "reviewed")
      expect(response).to have_http_status(:unprocessable_entity)
      expect(json).to include("code" => "invalid_request", "error" => "A reviewed approval can cover only one person's shifts")
      expect(entries.map { |entry| entry.reload.approval_status }).to eq(%w[pending pending])
      expect(ReviewBatch.count).to eq(0)
    end

    it "is capped below the ordinary limit" do
      stub_const("Approvals::ApproveReviewBatch::REVIEWED_MAX_ITEMS", 1)
      entries = [ clock_shift(employee, wednesday), clock_shift(employee, Date.new(2026, 4, 9)) ]
      post_review_batch(manager, entries.map { |entry| item_for(entry) }, mode: "reviewed")
      expect(response).to have_http_status(:unprocessable_entity)
      expect(json).to include("code" => "too_many_items", "error" => "A reviewed approval can cover at most 1 shifts")

      post_review_batch(manager, entries.map { |entry| item_for(entry) })
      expect(response).to have_http_status(:created)
    end
  end

  it "refuses needs-a-look shifts in ordinary mode" do
    added = create(:time_entry, user: employee, time_category: review_category, work_date: wednesday, entry_method: "manual", approval_status: "pending")
    ordinary = clock_shift(ethan, wednesday)
    post_review_batch(manager, [ item_for(added), item_for(ordinary) ])
    expect(response).to have_http_status(:conflict)
    expect(json).to include("code" => "needs_look", "changed_ids" => [ added.id ])
    expect(ordinary.reload.approval_status).to eq("pending")
  end

  describe "Idempotency-Key" do
    it "returns the same batch when a request is replayed" do
      entries = [ clock_shift(employee, wednesday), clock_shift(ethan, wednesday) ]
      items = entries.map { |entry| item_for(entry) }
      post_review_batch(manager, items, key: "double-tap-1")
      first = json

      post_review_batch(manager, items, key: "double-tap-1")
      expect(response).to have_http_status(:ok)
      expect(json).to include("review_batch_id" => first["review_batch_id"], "replayed" => true, "approved_count" => 2)
      expect(ReviewBatch.count).to eq(1)
      expect(AuditLog.where(action: "time_entry.approved").count).to eq(2)
    end

    it "refuses a reused key with a different request, and a missing key" do
      entry = clock_shift(employee, wednesday)
      post_review_batch(manager, [ item_for(entry) ], key: "reused")
      other = clock_shift(ethan, wednesday)
      post_review_batch(manager, [ item_for(other) ], key: "reused")
      expect(response).to have_http_status(:unprocessable_entity)
      expect(json["code"]).to eq("idempotency_key_reused")
      expect(other.reload.approval_status).to eq("pending")

      post "/api/v1/time_entries/review_batch", params: { items: [ item_for(other) ] }, headers: headers_for(manager), as: :json
      expect(response).to have_http_status(:unprocessable_entity)
      expect(json["code"]).to eq("idempotency_key_required")
    end

    it "replays when the same key wins a race to the insert" do
      entry = clock_shift(employee, wednesday)
      items = [ item_for(entry) ]
      post_review_batch(manager, items, key: "raced")
      first = json
      # The second request's lookup ran before the first committed.
      allow(ReviewBatch).to receive(:find_by).and_call_original
      allow(ReviewBatch).to receive(:find_by).with(actor_id: manager.id, idempotency_key: "raced").and_return(nil)

      post_review_batch(manager, items, key: "raced")
      expect(response).to have_http_status(:ok)
      expect(json).to include("review_batch_id" => first["review_batch_id"], "replayed" => true)
    end

    it "doesn't treat any other unique violation as a replay" do
      entry = clock_shift(employee, wednesday)
      allow(ReviewBatchItem).to receive(:insert_all!).and_raise(ActiveRecord::RecordNotUnique, "duplicate key value violates unique constraint \"index_review_batch_items_on_review_batch_id_and_time_entry_id\"")

      expect do
        Approvals::ApproveReviewBatch.call(actor: manager, items: [ item_for(entry) ], idempotency_key: "not-a-race")
      end.to raise_error(ActiveRecord::RecordNotUnique)
      expect(entry.reload.approval_status).to eq("pending")
      expect(ReviewBatch.count).to eq(0)
    end

    it "keeps keys per approver" do
      first = clock_shift(employee, wednesday)
      second = clock_shift(ethan, wednesday)
      post_review_batch(manager, [ item_for(first) ], key: "shared")
      post_review_batch(admin, [ item_for(second) ], key: "shared")
      expect(response).to have_http_status(:created)
      expect(ReviewBatch.count).to eq(2)
    end
  end

  it "invalidates exports that include an approved shift" do
    entry = clock_shift(employee, wednesday)
    export = protecting_export_for(entry)
    post_review_batch(manager, [ item_for(entry) ])
    expect(export.reload).to have_attributes(state: "stale")
    expect(export.stale_reason).to include("Approved in review batch #{json['review_batch_id']}")
  end

  it "caps a batch at the limit" do
    stub_const("Approvals::ApproveReviewBatch::MAX_ITEMS", 1)
    entries = [ clock_shift(employee, wednesday), clock_shift(ethan, wednesday) ]
    post_review_batch(manager, entries.map { |entry| item_for(entry) })
    expect(response).to have_http_status(:unprocessable_entity)
    expect(json).to include("code" => "too_many_items", "error" => "Approve at most 1 shifts at a time")
  end

  it "leaves bulk_approve working for older clients" do
    entry = clock_shift(employee, wednesday)
    post "/api/v1/time_entries/bulk_approve", params: { entry_ids: [ entry.id ] }, headers: headers_for(manager)
    expect(response).to have_http_status(:ok)
    expect(entry.reload.approval_status).to eq("approved")
  end

  # Leon's batch-limit decision: measure 250 before raising the limit from 100.
  # Runs only with REVIEW_BATCH_BENCHMARK=1: prints the timings and asserts the
  # 3s target. REVIEW_BATCH_PEOPLE=20 measures 100 shifts (five per person).
  it "measures a 250-shift batch and its undo" do
    skip "set REVIEW_BATCH_BENCHMARK=1 to run" unless ENV["REVIEW_BATCH_BENCHMARK"]

    people = Integer(ENV.fetch("REVIEW_BATCH_PEOPLE", "50"))
    size = people * 5
    stub_const("Approvals::ApproveReviewBatch::MAX_ITEMS", [ size, 100 ].max)
    days = (5..9).map { |day| Date.new(2026, 4, day) }
    entries = people.times.flat_map do |index|
      person = create(:user, :employee, first_name: "Person#{index}")
      days.map { |day| clock_shift(person, day, hours: 7) }
    end
    items = entries.map { |entry| item_for(entry) }

    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    get "/api/v1/time_entries/pending_approvals", headers: headers_for(manager)
    list_seconds = Process.clock_gettime(Process::CLOCK_MONOTONIC) - started
    expect(response.parsed_body["review_summary"]).to include("ordinary_count" => size, "complete" => true)

    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    post_review_batch(manager, items)
    approve_seconds = Process.clock_gettime(Process::CLOCK_MONOTONIC) - started
    expect(response).to have_http_status(:created)
    expect(TimeEntry.where(id: entries.map(&:id), approval_status: "approved").count).to eq(size)

    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    post "/api/v1/time_entries/review_batches/#{json['review_batch_id']}/undo", headers: headers_for(manager), as: :json
    undo_seconds = Process.clock_gettime(Process::CLOCK_MONOTONIC) - started
    expect(response).to have_http_status(:ok)
    expect(TimeEntry.where(id: entries.map(&:id), approval_status: "pending").count).to eq(size)

    puts format("\n  %d shifts: pending_approvals %.2fs, review batch %.2fs, undo %.2fs", size, list_seconds, approve_seconds, undo_seconds)
    expect(approve_seconds).to be < 3
  end
end
