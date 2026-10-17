# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Explicit time entry review corrections", type: :request do
  include ActiveSupport::Testing::TimeHelpers
  let(:admin) { create(:user, :admin) }
  let(:employee) { create(:user, :employee) }
  let(:category) { create(:time_category) }
  let(:zone) { ActiveSupport::TimeZone["Pacific/Guam"] }
  let(:start) { zone.local(2026, 11, 1, 8) }
  let(:entry) do
    create(:time_entry, user: employee, time_category: category, work_date: start.to_date,
           entry_method: "clock", status: "clocked_in", start_time: start, clock_in_at: start,
           end_time: nil, clock_out_at: nil, hours: 0)
  end
  before do
    travel_to zone.local(2026, 11, 24, 12)
    employee.user_time_categories.create!(time_category: category)
  end
  after { travel_back }

  def submit(action: "end_clock", actor: admin, reason: "Confirmed actual stop with employee", overrides: {})
    patch "/api/v1/time_entries/#{entry.id}", headers: { "Authorization" => "Bearer test_token_#{actor.id}" },
          params: { correction_reason: reason, time_entry: {
            review_action: action, expected_version: entry.lock_version, stop_date: "2026-11-01",
            end_time: "12:00", time_category_id: category.id
          }.merge(overrides) }
  end

  it "ends the exact historical clock and requires a separate approval" do
    entry.update!(approval_status: "approved", approved_by: admin, approved_at: start,
                  overtime_status: "approved", overtime_approved_by: admin, overtime_approved_at: start)
    submit
    expect(response).to have_http_status(:ok)
    expect(entry.reload).to have_attributes(status: "completed", hours: 4, approval_status: "pending",
      clock_out_at: zone.local(2026, 11, 1, 12),
      approved_by_id: nil, approved_at: nil, overtime_approved_by_id: nil, overtime_approved_at: nil)
    expect(entry.end_time.in_time_zone("Pacific/Guam").strftime("%H:%M")).to eq("12:00")
    expect(entry.counts_toward_hours?).to be(false)
    expect(AuditLog.where(action: "time_entry.clock_ended").last.metadata["correction_reason"]).to be_present
  end

  it "preserves ordinary active editing without ending the clock or selecting a category" do
    entry.update_columns(time_category_id: nil)
    patch "/api/v1/time_entries/#{entry.id}", headers: { "Authorization" => "Bearer test_token_#{admin.id}" },
      params: { time_entry: { description: "Awaiting actual stop", end_time: "12:00" } }
    expect(response).to have_http_status(:ok)
    expect(entry.reload).to have_attributes(status: "clocked_in", end_time: nil, clock_out_at: nil, time_category_id: nil)
  end

  [ nil, "" ].each do |blank_category|
    it "preserves a missing category on a notes-only active edit with #{blank_category.inspect}" do
      entry.update_columns(time_category_id: nil)
      patch "/api/v1/time_entries/#{entry.id}", headers: { "Authorization" => "Bearer test_token_#{admin.id}" },
        params: { time_entry: { description: "Awaiting category choice", time_category_id: blank_category } }
      expect(response).to have_http_status(:ok)
      expect(entry.reload.time_category_id).to be_nil
    end
  end

  it "requires an explicit assigned category to complete an uncategorized clock" do
    entry.update_columns(time_category_id: nil)
    submit(overrides: { time_category_id: nil })
    expect(response).to have_http_status(:unprocessable_entity)
    expect(entry.reload.status).to eq("clocked_in")
  end

  [ nil, "" ].each do |reason|
    it "rejects closure without a reason #{reason.inspect}" do
      submit(reason: reason)
      expect(response).to have_http_status(:unprocessable_entity)
      expect(entry.reload.clock_out_at).to be_nil
    end
  end

  [ { stop_date: "2026-11-25" }, { end_time: "08:00" }, { end_time: "07:00" },
    { stop_date: "2026-11-03" }, { stop_date: "invalid" }, { end_time: "24:00" } ].each do |values|
    it "rejects invalid, future, nonpositive or unsupported stop #{values}" do
      submit(overrides: values)
      expect(response).to have_http_status(:unprocessable_entity)
      expect(entry.reload.status).to eq("clocked_in")
    end
  end

  it "closes an open break at the historical stop and computes net hours" do
    entry.update!(status: "on_break")
    entry.time_entry_breaks.create!(start_time: zone.local(2026, 11, 1, 11))
    submit
    expect(response).to have_http_status(:ok)
    expect(entry.reload).to have_attributes(hours: 3, break_minutes: 60)
    expect(entry.time_entry_breaks.first.end_time).to eq(entry.clock_out_at)
    audit = AuditLog.find_by!(action: "time_entry.clock_ended")
    expect(audit.metadata.dig("before", "breaks", 0, "end_time")).to be_nil
    expect(audit.metadata.dig("after", "breaks", 0, "end_time")).to be_present
  end

  it "rejects a stop before an existing break and leaves the break open" do
    entry.time_entry_breaks.create!(start_time: zone.local(2026, 11, 1, 13))
    submit
    expect(response).to have_http_status(:unprocessable_entity)
    expect(entry.time_entry_breaks.first.end_time).to be_nil
  end

  it "rejects overlapping breaks" do
    entry.time_entry_breaks.create!(start_time: start + 1.hour, end_time: start + 2.hours)
    entry.time_entry_breaks.create!(start_time: start + 90.minutes, end_time: start + 3.hours)
    submit
    expect(response).to have_http_status(:unprocessable_entity)
  end

  it "preserves aggregate break minutes and rejects zero net time" do
    entry.update!(break_minutes: 240)
    submit
    expect(response).to have_http_status(:unprocessable_entity)
    expect(entry.reload.status).to eq("clocked_in")
  end

  it "rejects stale versions without changing the entry" do
    old_version = entry.lock_version
    entry.update!(description: "Another operator updated this")
    submit(overrides: { expected_version: old_version })
    expect(response).to have_http_status(:conflict)
    expect(entry.reload.status).to eq("clocked_in")
  end

  it "forbids employees from ending even their own clock through the admin transition" do
    submit(actor: employee)
    expect(response).to have_http_status(:forbidden)
    expect(entry.reload.status).to eq("clocked_in")
  end

  it "rejects closure of an already completed entry" do
    entry.update!(status: "completed", end_time: start + 4.hours, clock_out_at: start + 4.hours)
    submit
    expect(response).to have_http_status(:unprocessable_entity)
  end

  it "invalidates protected exports and leaves frozen exclusions and payload unchanged" do
    entry
    batch = Payroll::BatchFinalizer.new(start_date: entry.work_date, end_date: entry.work_date, actor: admin).call
    frozen = batch.attributes.deep_dup
    exclusions = batch.payroll_batch_exclusions.map(&:attributes)
    export = ReportExport.create!(public_id: "AIRE-PAYROLL-REVIEW-#{SecureRandom.hex(4)}",
      export_type: "payroll_time_summary", readiness_status: "complete", state: "active",
      start_date: entry.work_date, end_date: entry.work_date, employee_ids: [ employee.id ], entry_ids: [ entry.id ],
      filters: {}, summary: {}, issues: {}, entry_snapshot: [], checksum: SecureRandom.hex(16),
      protects_entries: true, generated_at: Time.current, last_downloaded_at: Time.current)
    submit(reason: "")
    expect(response).to have_http_status(:unprocessable_entity)
    submit
    expect(response).to have_http_status(:ok)
    expect(batch.reload.attributes).to eq(frozen)
    expect(batch.payroll_batch_exclusions.reload.map(&:attributes)).to eq(exclusions)
    expect(export.reload.state).to eq("stale")
    audit = AuditLog.find_by!(action: "time_entry.clock_ended")
    expect(audit.metadata["finalized_payroll_batch_ids"]).to eq([ batch.public_id ])
  end

  it "rolls back closure, breaks and audit if export invalidation fails" do
    entry.time_entry_breaks.create!(start_time: start + 3.hours)
    allow(ReportExport).to receive(:invalidate_for_entry!).and_raise("invalidation failed")
    submit
    expect(response).to have_http_status(:internal_server_error)
    expect(entry.reload.status).to eq("clocked_in")
    expect(entry.time_entry_breaks.first.end_time).to be_nil
    expect(AuditLog.where(action: "time_entry.clock_ended")).to be_empty
  end

  it "captures post-cutoff changes through the normal job and keeps the origin case" do
    entry.update_columns(created_at: start, updated_at: start)
    period = create(:payroll_calendar_period, start_date: start.to_date, end_date: start.to_date + 14.days,
                    pay_date: Date.new(2026, 11, 30), cutoff_at: zone.local(2026, 11, 23, 17))
    expect(Payroll::ScheduledCutoffFinalizer.new(period_id: period.id).call[:status]).to eq("finalized")
    origin = PayrollSettlementCase.find_by!(source_time_entry_id: entry.id)
    expect { submit }.to have_enqueued_job(PayrollSettlementCaseCaptureJob).with(entry.id, nil, admin.id)
    expect(response).to have_http_status(:ok)
    PayrollSettlementCaseCaptureJob.perform_now(entry.id, nil, admin.id)
    expect(origin.reload.origin_reason).to eq("open_clock")
    expect(origin.source_time_entry_id).to eq(entry.id)
  end

  it "recomputes weekly overtime and clears prior overtime approval" do
    (0..3).each do |offset|
      create(:time_entry, user: employee, time_category: category, work_date: start.to_date + offset.days,
             approval_status: "approved", start_time: zone.local(2000, 1, 1, 8), end_time: zone.local(2000, 1, 1, 16))
    end
    target_start = zone.local(2026, 11, 5, 8)
    entry.update!(work_date: target_start.to_date, start_time: target_start, clock_in_at: target_start,
                  overtime_status: "approved", overtime_approved_by: admin, overtime_approved_at: start)
    submit(overrides: { stop_date: "2026-11-05", end_time: "18:00" })
    expect(response).to have_http_status(:ok)
    expect(entry.reload.overtime_status).to eq("pending")
    expect(entry.overtime_approved_at).to be_nil
  end

  context "denied time" do
    let(:entry) do
      create(:time_entry, user: employee, time_category: category, work_date: start.to_date,
             entry_method: "manual", status: "completed", start_time: "08:00", end_time: "12:00",
             approval_status: "denied", approved_by: admin, approved_at: start, approval_note: "Original denial")
    end
    it "resubmits unchanged four-hour facts and retains the denial in history" do
      before = entry.attributes.slice("hours", "start_time", "end_time", "work_date", "time_category_id", "description")
      submit(action: "resubmit_denied", overrides: { start_time: "10:00", end_time: "18:00", hours: 8 })
      expect(response).to have_http_status(:ok)
      expect(entry.reload.attributes.slice(*before.keys)).to eq(before)
      expect(entry).to have_attributes(approval_status: "pending", approved_by_id: nil, approved_at: nil)
      expect(entry.approval_note).to include("Original denial")
      audit = AuditLog.find_by!(action: "time_entry.denied_resubmitted")
      expect(audit.metadata.dig("before", "approved_by_id")).to eq(admin.id)
      expect(audit.metadata.dig("before", "approval_status")).to eq("denied")
      expect(entry.counts_toward_hours?).to be(false)
    end
    it "preserves the denied exclusion and still requires the normal separate approval" do
      entry.update_columns(created_at: start, updated_at: start)
      batch = Payroll::BatchFinalizer.new(start_date: entry.work_date, end_date: entry.work_date, actor: admin).call
      original = [ batch.attributes.deep_dup, batch.payroll_batch_exclusions.map(&:attributes) ]
      post "/api/v1/time_entries/#{entry.id}/approve", headers: { "Authorization" => "Bearer test_token_#{admin.id}" }
      expect(response).to have_http_status(:unprocessable_entity)
      submit(action: "resubmit_denied")
      expect(response).to have_http_status(:ok)
      expect(entry.reload.approval_status).to eq("pending")
      post "/api/v1/time_entries/#{entry.id}/approve", headers: { "Authorization" => "Bearer test_token_#{admin.id}" }
      expect(response).to have_http_status(:ok)
      expect(entry.reload).to have_attributes(hours: 4, approval_status: "approved", approved_by_id: admin.id)
      expect([ batch.reload.attributes, batch.payroll_batch_exclusions.reload.map(&:attributes) ]).to eq(original)
    end

    [ "inactive", "unassigned" ].each do |category_state|
      it "rejects #{category_state} denied categories without changing facts, successful audit or frozen history" do
        entry
        batch = Payroll::BatchFinalizer.new(start_date: entry.work_date, end_date: entry.work_date, actor: admin).call
        frozen = [ batch.attributes.deep_dup, batch.payroll_batch_exclusions.map(&:attributes) ]
        original = entry.reload.attributes.deep_dup
        if category_state == "inactive"
          category.update!(is_active: false)
        else
          employee.user_time_categories.find_by!(time_category: category).destroy!
        end
        audit_count = AuditLog.where(auditable: entry, outcome: "succeeded").count
        submit(action: "resubmit_denied")
        expect(response).to have_http_status(:unprocessable_entity)
        expect(JSON.parse(response.body).fetch("error")).to eq("Choose an active work category assigned to this person")
        expect(entry.reload.attributes).to eq(original)
        expect(AuditLog.where(auditable: entry, outcome: "succeeded").count).to eq(audit_count)
        failed_request = AuditLog.find_by!(auditable: entry, action: "time_entries.update", outcome: "failed")
        expect(failed_request.metadata["response_status"]).to eq(422)
        expect(AuditLog.where(action: "time_entry.denied_resubmitted")).to be_empty
        expect([ batch.reload.attributes, batch.payroll_batch_exclusions.reload.map(&:attributes) ]).to eq(frozen)
      end
    end

    it "requires a reason for resubmission" do
      submit(action: "resubmit_denied", reason: "")
      expect(response).to have_http_status(:unprocessable_entity)
      expect(entry.reload.approval_status).to eq("denied")
    end
    it "does not permit repeated resubmission or direct approval" do
      submit(action: "resubmit_denied")
      expect(response).to have_http_status(:ok)
      entry.reload
      submit(action: "resubmit_denied")
      expect(response).to have_http_status(:unprocessable_entity)
      expect(entry.reload.approval_status).to eq("pending")
    end
    it "does not expand employee authorization" do
      submit(action: "resubmit_denied", actor: employee)
      expect(response).to have_http_status(:forbidden)
      expect(entry.reload.approval_status).to eq("denied")
    end
  end
end
