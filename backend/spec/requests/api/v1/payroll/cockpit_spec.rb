# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Payroll cockpit API", type: :request do
  include ActiveSupport::Testing::TimeHelpers

  let(:secret) { "cornerstone-cockpit-secret" }
  let(:admin) { create(:user, :admin, is_active: true, personal_access_enabled: true) }
  let(:employee) { create(:user, :employee, first_name: "Ari", last_name: "Worker") }
  let(:category) { create(:time_category, name: "Operations", key: "operations") }
  let(:period) { create(:payroll_calendar_period) }
  let(:delegation) do
    PayrollIntegrationGrant.issue!(
      user: admin,
      capabilities: %w[time_approval payroll_finalization]
    )
  end
  let(:headers) do
    {
      "X-Payroll-Shared-Secret" => secret,
      "X-Aire-Delegation-Token" => delegation.issued_token,
      "Content-Type" => "application/json"
    }
  end

  around do |example|
    previous = ENV["PAYROLL_SHARED_SECRET"]
    ENV["PAYROLL_SHARED_SECRET"] = secret
    example.run
  ensure
    ENV["PAYROLL_SHARED_SECRET"] = previous
  end

  def json
    response.parsed_body.deep_symbolize_keys
  end

  def create_entry(**attributes)
    create(
      :time_entry,
      {
        user: employee,
        time_category: category,
        work_date: period.start_date,
        entry_method: "manual",
        status: "completed",
        approval_status: "pending",
        overtime_status: "none"
      }.merge(attributes)
    )
  end

  it "requires the integration secret for every cockpit read" do
    paths = [
      "/api/v1/payroll/cockpit/employees",
      "/api/v1/payroll/cockpit/exceptions?external_pay_period_id=missing",
      "/api/v1/payroll/cockpit/time_entries?external_pay_period_id=missing",
      "/api/v1/payroll/cockpit/manual_review?start_date=2026-10-01&end_date=2026-10-15",
      "/api/v1/payroll/cockpit/periods/missing"
    ]

    paths.each do |path|
      expect do
        get path
      end.to change { AuditLog.where(action: "payroll_cockpit.authorization_denied").count }.by(1)
      expect(response).to have_http_status(:unauthorized)
    end
  end

  it "returns only payroll-appropriate employee identity fields with bounded pagination" do
    employee.assigned_time_categories << category

    get "/api/v1/payroll/cockpit/employees", params: { per_page: 500 }, headers: headers

    expect(response).to have_http_status(:ok)
    expect(json.dig(:pagination, :per_page)).to eq(100)
    expect(json.fetch(:employees)).to include(
      include(
        payroll_integration_id: employee.payroll_integration_uuid,
        full_name: "Ari Worker",
        time_categories: [ include(key: "operations") ]
      )
    )
    expect(json.fetch(:employees).first).not_to have_key(:phone)
    expect(AuditLog.where(action: "payroll_cockpit.read", source: "integration")).to exist
  end

  it "ignores a blank employee active filter" do
    employee
    create(:user, :employee, is_active: false, personal_access_enabled: false, time_tracking_enabled: false)

    get "/api/v1/payroll/cockpit/employees", params: { active: "" }, headers: headers

    expect(response).to have_http_status(:ok)
    expect(json.dig(:pagination, :total_count)).to eq(3)
  end

  it "rejects an unrecognized employee active filter" do
    get "/api/v1/payroll/cockpit/employees", params: { active: "inactive" }, headers: headers

    expect(response).to have_http_status(:unprocessable_entity)
    expect(json.fetch(:error)).to eq("active must be true or false")
  end

  it "returns full entry detail, lifecycle, exceptions, leave, and carryover summaries" do
    employee.assigned_time_categories << category
    entry = create_entry(description: "Corrected shift")
    create(:leave_request, user: employee, start_date: period.start_date, end_date: period.start_date + 1.day)

    get "/api/v1/payroll/cockpit/time_entries",
        params: { external_pay_period_id: period.external_pay_period_id }, headers: headers

    expect(response).to have_http_status(:ok)
    expect(json.dig(:time_entries, 0)).to include(
      id: entry.id.to_s,
      version: 0,
      work_date: period.start_date.iso8601,
      description: "Corrected shift"
    )
    expect(json.dig(:time_entries, 0, :capture)).to include(entry_method: "manual", ordinary: false)
    expect(json.dig(:time_entries, 0, :available_time_categories)).to eq([
      { id: category.id.to_s, key: "operations", name: "Operations" }
    ])
    expect(json.dig(:time_entries, 0, :state)).to include(approval_status: "pending", payable_now: false)
    expect(json.dig(:time_entries, 0, :lifecycle)).to include(status: "awaiting_approval")

    get "/api/v1/payroll/cockpit/exceptions",
        params: {
          external_pay_period_id: period.external_pay_period_id,
          per_page: 1,
          leave_per_page: 7
        },
        headers: headers

    expect(response).to have_http_status(:ok)
    expect(json.dig(:time_exceptions, 0, :id)).to eq(entry.id.to_s)
    expect(json.dig(:leave_exceptions, 0, :employee, :payroll_integration_id)).to eq(employee.payroll_integration_uuid)
    expect(json.dig(:time_exception_pagination, :per_page)).to eq(1)
    expect(json.dig(:leave_exception_pagination, :per_page)).to eq(7)
    expect(json.fetch(:carryovers)).to include(:items, :summary, :truncated)
  end

  it "reports legacy manual entries without an approval state as exceptions" do
    entry = create_entry(approval_status: nil)

    get "/api/v1/payroll/cockpit/exceptions",
        params: { external_pay_period_id: period.external_pay_period_id },
        headers: headers

    expect(response).to have_http_status(:ok)
    expect(json.fetch(:time_exceptions)).to include(include(id: entry.id.to_s))
    expect(json.dig(:time_exceptions, 0, :state)).to include(approval_status: "pending", payable_now: false)
  end

  it "summarizes readiness and exposes the immutable batch and processing history" do
    create_entry(entry_method: "clock", approval_status: nil, hours: 8)

    get "/api/v1/payroll/cockpit/periods/#{period.external_pay_period_id}", headers: headers

    expect(response).to have_http_status(:ok)
    expect(json.dig(:payroll_period, :version)).to eq(0)
    expect(json.fetch(:readiness)).to include(
      total_entries: 1,
      eligible_entries: 1,
      eligible_hours: 8.0,
      held_entries: 0,
      held_hours: 0.0,
      pending_approvals: 0
    )
  end

  it "previews exact regular, overtime, and carryover hours for manual payroll entry without a calendar period" do
    manual_start = period.end_date + 1.day
    manual_end = manual_start + 14.days
    carryover = create_entry(
      work_date: period.end_date,
      entry_method: "manual",
      approval_status: "pending",
      start_time: ActiveSupport::TimeZone["Pacific/Guam"].local(2000, 1, 1, 9, 0),
      end_time: ActiveSupport::TimeZone["Pacific/Guam"].local(2000, 1, 1, 11, 30)
    )
    travel_to(period.cutoff_at + 1.minute) do
      expect(Payroll::ScheduledCutoffFinalizer.new(period_id: period.id, now: Time.current).call.fetch(:status))
        .to eq("finalized")
    end
    carryover.update!(
      approval_status: "approved",
      approved_at: manual_start.beginning_of_day,
      approved_by: admin
    )
    create_entry(
      work_date: manual_start,
      entry_method: "clock",
      approval_status: nil,
      hours: 8
    )
    expect(PayrollCalendarPeriod.where("start_date <= ? AND end_date >= ?", manual_end, manual_start)).to be_empty

    travel_to(manual_end.end_of_day) do
      get "/api/v1/payroll/cockpit/manual_review",
          params: { start_date: manual_start.iso8601, end_date: manual_end.iso8601 },
          headers: headers
    end

    expect(response).to have_http_status(:ok)
    employee = json.fetch(:employees).find { |row| row.fetch(:source_user_id) == carryover.user_id.to_s }
    expect(employee).to include(total_hours: 10.5, regular_hours: 10.5, overtime_hours: 0.0)
    expect(employee.fetch(:adjustments)).to include(include(source_kind: "carryover", total_hours: 2.5))
    expect(json.fetch(:summary)).to include(total_hours: 10.5, carryover_count: 1)
    expect(json).not_to include(:batch_id, :checksum)
  end

  it "validates manual-review dates" do
    get "/api/v1/payroll/cockpit/manual_review",
        params: { start_date: "not-a-date", end_date: period.end_date.iso8601 },
        headers: headers

    expect(response).to have_http_status(:unprocessable_entity)
    expect(json.fetch(:error)).to include("start_date must be a valid ISO 8601 date")
  end

  it "reports eligibility at the immutable cutoff instead of the entry's current state" do
    cutoff = period.cutoff_at
    ordinary = create_entry(
      entry_method: "clock",
      approval_status: nil,
      hours: 8,
      created_at: cutoff + 1.minute,
      updated_at: cutoff + 1.minute
    )
    manual = create_entry(
      hours: 7.5,
      approval_status: "approved",
      approved_at: cutoff + 2.minutes,
      approved_by: admin,
      created_at: cutoff - 1.day,
      updated_at: cutoff + 2.minutes
    )

    get "/api/v1/payroll/cockpit/periods/#{period.external_pay_period_id}", headers: headers

    expect(response).to have_http_status(:ok)
    expect(json.fetch(:readiness)).to include(
      total_hours: 16.0,
      eligible_entries: 0,
      eligible_hours: 0.0,
      held_entries: 2,
      held_hours: 16.0,
      pending_approvals: 0
    )

    get "/api/v1/payroll/cockpit/time_entries",
        params: { external_pay_period_id: period.external_pay_period_id }, headers: headers

    states = json.fetch(:time_entries).index_by { |entry| entry.fetch(:id) }
    expect(states.dig(ordinary.id.to_s, :state)).to include(
      payable_now: false,
      payroll_disposition: "created_after_cutoff",
      payroll_exclusion_reasons: [ "created_after_cutoff" ]
    )
    expect(states.dig(manual.id.to_s, :state)).to include(
      payable_now: false,
      payroll_disposition: "approved_after_cutoff",
      payroll_exclusion_reasons: [ "approved_after_cutoff" ]
    )

    get "/api/v1/payroll/cockpit/exceptions",
        params: { external_pay_period_id: period.external_pay_period_id }, headers: headers

    expect(json.fetch(:time_exceptions).pluck(:id)).to contain_exactly(ordinary.id.to_s, manual.id.to_s)
  end

  it "keeps finalized cockpit totals tied to the persisted batch after later approval" do
    cutoff = period.cutoff_at
    entry = create_entry(
      hours: 8,
      created_at: cutoff - 1.day,
      updated_at: cutoff - 1.day
    )

    travel_to(cutoff + 1.minute) do
      result = Payroll::ScheduledCutoffFinalizer.new(period_id: period.id, now: Time.current).call
      expect(result.fetch(:status)).to eq("finalized")
      TimeClockService.approve_entry(entry: entry, approved_by: admin, note: "Approved after cutoff")
    end

    get "/api/v1/payroll/cockpit/periods/#{period.external_pay_period_id}", headers: headers

    expect(response).to have_http_status(:ok)
    expect(json.fetch(:readiness)).to include(
      eligible_entries: 0,
      eligible_hours: 0.0,
      held_entries: 1,
      held_hours: 8.0,
      pending_approvals: 0
    )

    get "/api/v1/payroll/cockpit/time_entries",
        params: { external_pay_period_id: period.external_pay_period_id }, headers: headers

    expect(json.dig(:time_entries, 0, :state)).to include(
      payable_now: false,
      payroll_disposition: "pending_approval"
    )
  end

  it "does not rewrite a finalized category exception from the live entry" do
    cutoff = period.cutoff_at
    entry = create_entry(
      entry_method: "clock",
      approval_status: nil,
      created_at: cutoff - 1.day,
      updated_at: cutoff - 1.day
    )
    entry.update_columns(time_category_id: nil, updated_at: cutoff - 1.day)

    travel_to(cutoff + 1.minute) do
      result = Payroll::ScheduledCutoffFinalizer.new(period_id: period.id, now: Time.current).call
      expect(result.fetch(:status)).to eq("finalized")
    end
    entry.update!(time_category: category)

    get "/api/v1/payroll/cockpit/time_entries",
        params: { external_pay_period_id: period.external_pay_period_id }, headers: headers

    expect(response).to have_http_status(:ok)
    expect(json.dig(:time_entries, 0, :state)).to include(
      payable_now: true,
      payroll_disposition: "missing_category"
    )
  end

  it "shows time submitted after finalization as held for the next payroll" do
    cutoff = period.cutoff_at
    travel_to(cutoff + 1.minute) do
      result = Payroll::ScheduledCutoffFinalizer.new(period_id: period.id, now: Time.current).call
      expect(result.fetch(:status)).to eq("finalized")
    end

    late_entry = travel_to(cutoff + 2.minutes) do
      create_entry(entry_method: "clock", approval_status: nil)
    end

    get "/api/v1/payroll/cockpit/periods/#{period.external_pay_period_id}", headers: headers

    expect(response).to have_http_status(:ok)
    expect(json.fetch(:readiness)).to include(held_entries: 1, held_hours: 8.0)

    get "/api/v1/payroll/cockpit/exceptions",
        params: { external_pay_period_id: period.external_pay_period_id }, headers: headers

    expect(json.fetch(:time_exceptions).pluck(:id)).to eq([ late_entry.id.to_s ])
    expect(json.dig(:time_exceptions, 0, :state)).to include(
      payable_now: false,
      payroll_disposition: "created_after_cutoff"
    )
  end

  it "holds an older entry moved into a finalized period" do
    cutoff = period.cutoff_at
    entry = create_entry(
      work_date: period.start_date - 1.day,
      entry_method: "clock",
      approval_status: nil,
      created_at: cutoff - 1.day,
      updated_at: cutoff - 1.day
    )
    travel_to(cutoff + 1.minute) do
      expect(Payroll::ScheduledCutoffFinalizer.new(period_id: period.id, now: Time.current).call.fetch(:status))
        .to eq("finalized")
      entry.update!(work_date: period.start_date)
    end

    get "/api/v1/payroll/cockpit/exceptions",
        params: { external_pay_period_id: period.external_pay_period_id }, headers: headers

    expect(response).to have_http_status(:ok)
    expect(json.fetch(:time_exceptions).pluck(:id)).to eq([ entry.id.to_s ])
    expect(json.dig(:time_exceptions, 0, :state)).to include(
      payable_now: false,
      payroll_disposition: "changed_after_cutoff"
    )
  end

  it "retains an included entry moved outside its finalized period" do
    cutoff = period.cutoff_at
    entry = create_entry(
      entry_method: "clock",
      approval_status: nil,
      created_at: cutoff - 1.day,
      updated_at: cutoff - 1.day
    )
    travel_to(cutoff + 1.minute) do
      expect(Payroll::ScheduledCutoffFinalizer.new(period_id: period.id, now: Time.current).call.fetch(:status))
        .to eq("finalized")
      entry.update!(work_date: period.start_date - 1.day)
    end

    get "/api/v1/payroll/cockpit/time_entries",
        params: { external_pay_period_id: period.external_pay_period_id }, headers: headers

    expect(response).to have_http_status(:ok)
    expect(json.fetch(:time_entries).pluck(:id)).to eq([ entry.id.to_s ])
    expect(json.dig(:time_entries, 0, :state)).to include(
      payable_now: true,
      payroll_disposition: "changed_after_cutoff",
      payroll_exclusion_reasons: [ "changed_after_cutoff" ]
    )

    get "/api/v1/payroll/cockpit/exceptions",
        params: { external_pay_period_id: period.external_pay_period_id }, headers: headers
    expect(json.fetch(:time_exceptions).pluck(:id)).to eq([ entry.id.to_s ])
  end

  it "requires an active AIRE administrator for commands" do
    entry = create_entry
    former_admin = create(:user, :admin)
    denied_grant = PayrollIntegrationGrant.issue!(user: former_admin, capabilities: [ "time_approval" ])
    former_admin.update!(role: "employee")
    denied_headers = headers.merge("X-Aire-Delegation-Token" => denied_grant.issued_token)

    post "/api/v1/payroll/cockpit/time_entries/#{entry.id}/approval",
         params: {
           command_id: SecureRandom.uuid,
           expected_version: entry.lock_version,
           decision: "approve",
           reason: "Reviewed for payroll"
         }.to_json,
         headers: denied_headers

    expect(response).to have_http_status(:forbidden)
    expect(entry.reload.approval_status).to eq("pending")
    expect(AuditLog.where(action: "payroll_cockpit.authorization_denied", outcome: "denied")).to exist
  end

  it "accepts a permanent, revocable account link instead of a delegation token" do
    entry = create_entry
    PayrollAccountLink.create!(
      user: admin,
      external_actor_id: "cornerstone-user-42",
      external_actor_email: "chels@example.com",
      linked_at: Time.current
    )

    post "/api/v1/payroll/cockpit/time_entries/#{entry.id}/approval",
         params: {
           command_id: SecureRandom.uuid,
           expected_version: entry.lock_version,
           decision: "approve",
           reason: "Reviewed through Cornerstone"
         }.to_json,
         headers: headers.except("X-Aire-Delegation-Token").merge("X-Cornerstone-Actor-Id" => "cornerstone-user-42")

    expect(response).to have_http_status(:ok)
    expect(entry.reload.approval_status).to eq("approved")
    expect(entry.approved_by).to eq(admin)
  end

  it "rejects revoked links and linked users who no longer have administrator access" do
    entry = create_entry
    invalid_states = [
      [ :revoked, {} ],
      [ :non_admin, { role: "employee" } ],
      [ :inactive, { is_active: false } ],
      [ :personal_access_disabled, { personal_access_enabled: false } ]
    ]

    invalid_states.each_with_index do |(state, user_attributes), index|
      actor = create(:user, :admin, is_active: true, personal_access_enabled: true)
      actor_id = "cornerstone-invalid-link-#{index}"
      link = PayrollAccountLink.create!(
        user: actor,
        external_actor_id: actor_id,
        external_actor_email: "operator-#{index}@example.com",
        linked_at: Time.current
      )
      if state == :revoked
        link.update_columns(active: false, revoked_at: Time.current, updated_at: Time.current)
      else
        actor.update_columns(user_attributes.merge(updated_at: Time.current))
      end

      post "/api/v1/payroll/cockpit/time_entries/#{entry.id}/approval",
           params: {
             command_id: SecureRandom.uuid,
             expected_version: entry.lock_version,
             decision: "approve",
             reason: "This request must remain blocked"
           }.to_json,
           headers: headers.except("X-Aire-Delegation-Token").merge("X-Cornerstone-Actor-Id" => actor_id)

      expect(response).to have_http_status(:forbidden), "expected #{state} link to be forbidden"
      expect(entry.reload.approval_status).to eq("pending")
    end
  end

  it "rejects delegations whose administrator is inactive or lacks personal access" do
    entry = create_entry

    [ { is_active: false }, { personal_access_enabled: false } ].each do |disabled_state|
      actor = create(:user, :admin)
      grant = PayrollIntegrationGrant.issue!(user: actor, capabilities: [ "time_approval" ])
      actor.update_columns(disabled_state.merge(updated_at: Time.current))

      post "/api/v1/payroll/cockpit/time_entries/#{entry.id}/approval",
           params: {
             command_id: SecureRandom.uuid,
             expected_version: entry.lock_version,
             decision: "approve",
             reason: "Reviewed"
           }.to_json,
           headers: headers.merge("X-Aire-Delegation-Token" => grant.issued_token)

      expect(response).to have_http_status(:forbidden)
    end

    expect(entry.reload.approval_status).to eq("pending")
  end

  it "requires an explicit actor identity for commands and audits the rejection" do
    entry = create_entry

    expect do
      post "/api/v1/payroll/cockpit/time_entries/#{entry.id}/approval",
           params: {
             command_id: SecureRandom.uuid,
             expected_version: entry.lock_version,
             decision: "approve",
             reason: "Reviewed"
           }.to_json,
           headers: headers.except("X-Aire-Delegation-Token")
    end.to change { AuditLog.where(action: "payroll_cockpit.authorization_denied").count }.by(1)

    expect(response).to have_http_status(:unauthorized)
  end

  it "approves once, replays safely, and rejects a reused command with different input" do
    entry = create_entry
    baseline_transactions = ActiveRecord::Base.connection.open_transactions
    expect(Payroll::BatchBuilder).to receive(:new).and_wrap_original do |original, *arguments, **keywords|
      expect(ActiveRecord::Base.connection.open_transactions).to eq(baseline_transactions)
      original.call(*arguments, **keywords)
    end
    command_id = SecureRandom.uuid
    payload = {
      command_id: command_id,
      expected_version: entry.lock_version,
      decision: "approve",
      reason: "Reviewed against the timecard"
    }

    expect do
      post "/api/v1/payroll/cockpit/time_entries/#{entry.id}/approval", params: payload.to_json, headers: headers
    end.to change(PayrollIntegrationCommand, :count).by(1)
      .and change { AuditLog.where(action: "payroll_cockpit.time_entry_approved").count }.by(1)

    expect(response).to have_http_status(:ok)
    expect(json.dig(:command, :replayed)).to be(false)
    expect(json.dig(:time_entry, :state, :approval_status)).to eq("approved")
    receipt = PayrollIntegrationCommand.find_by!(command_id: command_id)
    expect(receipt.result_metadata).to eq("decision" => "approve", "result_version" => 1)
    expect(receipt.result_metadata.to_json).not_to include(employee.email, "Reviewed against the timecard")

    expect do
      post "/api/v1/payroll/cockpit/time_entries/#{entry.id}/approval",
           params: payload.merge(reason: "  Reviewed against the timecard  ", decision: "APPROVE").to_json,
           headers: headers
    end.not_to change(PayrollIntegrationCommand, :count)
    expect(response).to have_http_status(:ok)
    expect(json.dig(:command, :replayed)).to be(true)
    expect(json).not_to have_key(:time_entry)
    expect(json.fetch(:command_result)).to include(decision: "approve", result_version: 1)

    post "/api/v1/payroll/cockpit/time_entries/#{entry.id}/approval",
         params: payload.merge(reason: "Different request").to_json, headers: headers
    expect(response).to have_http_status(:conflict)

    post "/api/v1/payroll/cockpit/time_entries/#{entry.id}/approval",
         params: payload.merge(decision: "unsupported").to_json, headers: headers
    expect(response).to have_http_status(:conflict)

    post "/api/v1/payroll/cockpit/time_entries/#{entry.id}/approval",
         params: payload.except(:reason).to_json, headers: headers
    expect(response).to have_http_status(:conflict)
  end

  it "rejects stale approval commands without changing the entry" do
    entry = create_entry
    entry.update!(description: "Changed in AIRE")

    post "/api/v1/payroll/cockpit/time_entries/#{entry.id}/approval",
         params: {
           command_id: SecureRandom.uuid,
           expected_version: 0,
           decision: "approve",
           reason: "Reviewed"
         }.to_json,
         headers: headers

    expect(response).to have_http_status(:conflict)
    expect(entry.reload.approval_status).to eq("pending")
    expect(AuditLog.where(action: "payroll_cockpit.command_rejected", outcome: "denied")).to exist
  end

  it "approves pending overtime idempotently through the delegated payroll actor" do
    entry = create_entry(approval_status: "approved", overtime_status: "pending")
    command_id = SecureRandom.uuid
    payload = {
      command_id: command_id,
      expected_version: entry.lock_version,
      decision: "approve",
      reason: "Overtime verified against the approved schedule"
    }

    expect do
      post "/api/v1/payroll/cockpit/time_entries/#{entry.id}/overtime_approval",
           params: payload.to_json,
           headers: headers
    end.to change(PayrollIntegrationCommand, :count).by(1)
      .and change { AuditLog.where(action: "payroll_cockpit.time_entry_overtime_approved").count }.by(1)

    expect(response).to have_http_status(:ok)
    expect(json.dig(:time_entry, :state, :overtime_status)).to eq("approved")
    expect(json.dig(:time_entry, :overtime_approval, :actor, :payroll_integration_id))
      .to eq(admin.payroll_integration_uuid)
    expect(entry.reload.overtime_note).to eq("Overtime verified against the approved schedule")
    expect(PayrollIntegrationCommand.find_by!(command_id: command_id).result_metadata)
      .to eq("decision" => "approve", "result_version" => 1)

    expect do
      post "/api/v1/payroll/cockpit/time_entries/#{entry.id}/overtime_approval",
           params: payload.merge(decision: "APPROVE", reason: "  Overtime verified against the approved schedule  ").to_json,
           headers: headers
    end.not_to change(PayrollIntegrationCommand, :count)
    expect(response).to have_http_status(:ok)
    expect(json.dig(:command, :replayed)).to be(true)
  end

  it "denies pending overtime only with an explicit reason" do
    entry = create_entry(approval_status: "approved", overtime_status: "pending")

    expect do
      post "/api/v1/payroll/cockpit/time_entries/#{entry.id}/overtime_approval",
           params: {
             command_id: SecureRandom.uuid,
             expected_version: entry.lock_version,
             decision: "deny"
           }.to_json,
           headers: headers
    end.not_to change(PayrollIntegrationCommand, :count)

    expect(response).to have_http_status(:unprocessable_entity)
    expect(entry.reload.overtime_status).to eq("pending")
    expect(AuditLog.where(action: "payroll_cockpit.time_entry_overtime_denied")).not_to exist

    post "/api/v1/payroll/cockpit/time_entries/#{entry.id}/overtime_approval",
         params: {
           command_id: SecureRandom.uuid,
           expected_version: entry.lock_version,
           decision: "deny",
           reason: "Overtime was not authorized"
         }.to_json,
         headers: headers

    expect(response).to have_http_status(:ok)
    expect(json.dig(:time_entry, :state, :overtime_status)).to eq("denied")
    expect(entry.reload.overtime_note).to eq("Overtime was not authorized")
    expect(AuditLog.where(action: "payroll_cockpit.time_entry_overtime_denied", outcome: "denied")).to exist
  end

  it "denies time with a reason and replays the denial without storing payroll data" do
    entry = create_entry
    command_id = SecureRandom.uuid
    payload = {
      command_id: command_id,
      expected_version: entry.lock_version,
      decision: "deny",
      reason: "The submitted shift was not worked"
    }

    expect do
      post "/api/v1/payroll/cockpit/time_entries/#{entry.id}/approval", params: payload.to_json, headers: headers
    end.to change { AuditLog.where(action: "payroll_cockpit.time_entry_denied").count }.by(1)

    expect(response).to have_http_status(:ok)
    expect(json.dig(:time_entry, :state, :approval_status)).to eq("denied")
    receipt = PayrollIntegrationCommand.find_by!(command_id: command_id)
    expect(receipt.result_metadata).to eq("decision" => "deny", "result_version" => 1)

    post "/api/v1/payroll/cockpit/time_entries/#{entry.id}/approval", params: payload.to_json, headers: headers
    expect(response).to have_http_status(:ok)
    expect(json).not_to have_key(:time_entry)
    expect(json.dig(:command, :replayed)).to be(true)

    pending_entry = create_entry
    post "/api/v1/payroll/cockpit/time_entries/#{pending_entry.id}/approval",
         params: {
           command_id: SecureRandom.uuid,
           expected_version: pending_entry.lock_version,
           decision: "deny",
           reason: "  "
         }.to_json,
         headers: headers
    expect(response).to have_http_status(:unprocessable_entity)
    expect(pending_entry.reload.approval_status).to eq("pending")
  end

  it "audits malformed command input" do
    entry = create_entry

    expect do
      post "/api/v1/payroll/cockpit/time_entries/#{entry.id}/approval",
           params: {
             command_id: "not-a-uuid",
             expected_version: entry.lock_version,
             decision: "approve",
             reason: "Reviewed"
           }.to_json,
           headers: headers
    end.to change { AuditLog.where(action: "payroll_cockpit.command_rejected", outcome: "failed").count }.by(1)

    expect(response).to have_http_status(:unprocessable_entity)
    expect(entry.reload.approval_status).to eq("pending")
  end

  it "audits a command with missing envelope fields" do
    entry = create_entry

    expect do
      post "/api/v1/payroll/cockpit/time_entries/#{entry.id}/approval",
           params: { decision: "approve", reason: "Reviewed" }.to_json,
           headers: headers
    end.to change { AuditLog.where(action: "payroll_cockpit.command_rejected", outcome: "failed").count }.by(1)

    expect(response).to have_http_status(:unprocessable_entity)
  end

  it "allows an administrator to trigger a due finalization idempotently" do
    cutoff = period.cutoff_at
    create_entry(entry_method: "clock", approval_status: nil)
    command_id = SecureRandom.uuid
    payload = {
      command_id: command_id,
      expected_version: period.lock_version,
      reason: "Retrying the scheduled cutoff"
    }

    travel_to(cutoff + 1.minute) do
      post "/api/v1/payroll/cockpit/periods/#{period.external_pay_period_id}/finalize",
           params: payload.to_json, headers: headers
      expect(response).to have_http_status(:accepted)
      expect(json.dig(:payroll_period, :status)).to eq("finalized")
      batch_id = json.dig(:payroll_period, :payroll_batch_id)

      post "/api/v1/payroll/cockpit/periods/#{period.external_pay_period_id}/finalize",
           params: payload.to_json, headers: headers
      expect(response).to have_http_status(:accepted)
      expect(json.dig(:command, :replayed)).to be(true)
      expect(json.dig(:result, :payroll_batch_id)).to eq(batch_id)
      expect(json).not_to have_key(:payroll_period)
    end
  end

  it "does not misrepresent later entry changes as an earlier command result" do
    entry = create_entry
    command_id = SecureRandom.uuid
    payload = {
      command_id: command_id,
      expected_version: entry.lock_version,
      decision: "approve",
      reason: "Reviewed"
    }

    post "/api/v1/payroll/cockpit/time_entries/#{entry.id}/approval", params: payload.to_json, headers: headers
    expect(response).to have_http_status(:ok)
    entry.reload.update!(description: "Changed after approval")

    post "/api/v1/payroll/cockpit/time_entries/#{entry.id}/approval", params: payload.to_json, headers: headers

    expect(response).to have_http_status(:ok)
    expect(json).not_to have_key(:time_entry)
    expect(json.fetch(:command_result)).to eq(decision: "approve", result_version: 1)
    expect(json.dig(:command, :replayed)).to be(true)
  end

  it "refuses to finalize before the published cutoff" do
    expect do
      travel_to(period.cutoff_at - 1.minute) do
        post "/api/v1/payroll/cockpit/periods/#{period.external_pay_period_id}/finalize",
             params: {
               command_id: SecureRandom.uuid,
               expected_version: period.lock_version,
               reason: "Trying early"
             }.to_json,
             headers: headers
      end
    end.to change { AuditLog.where(action: "payroll_cockpit.command_rejected", outcome: "failed").count }.by(1)

    expect(response).to have_http_status(:unprocessable_entity)
    expect(period.reload.status).to eq("scheduled")
    expect(PayrollIntegrationCommand.exists?).to be(false)
  end

  it "enforces the delegation capability for each command" do
    limited_grant = PayrollIntegrationGrant.issue!(user: admin, capabilities: [ "time_approval" ])

    travel_to(period.cutoff_at + 1.minute) do
      post "/api/v1/payroll/cockpit/periods/#{period.external_pay_period_id}/finalize",
           params: {
             command_id: SecureRandom.uuid,
             expected_version: period.lock_version,
             reason: "Run the due cutoff"
           }.to_json,
           headers: headers.merge("X-Aire-Delegation-Token" => limited_grant.issued_token)
    end

    expect(response).to have_http_status(:forbidden)
    expect(period.reload.status).to eq("scheduled")
  end

  it "lists settlement cases and routes one to a named supplemental payroll idempotently" do
    entry = create_entry
    settlement_case = create(
      :payroll_settlement_case,
      source_time_entry_id: entry.id,
      source_user_id: employee.id,
      source_user_uuid: employee.payroll_integration_uuid,
      source_snapshot: { employee_name: employee.full_name, work_date: entry.work_date.iso8601 }
    )
    second_entry = create_entry(work_date: period.start_date + 1.day)
    create(
      :payroll_settlement_case,
      origin_payroll_batch: settlement_case.origin_payroll_batch,
      source_time_entry_id: second_entry.id,
      source_user_id: employee.id,
      source_user_uuid: employee.payroll_integration_uuid
    )

    source_entry_loads = 0
    allow(TimeEntry).to receive(:includes).and_wrap_original do |original, *arguments|
      source_entry_loads += 1 if arguments == [ :user, :time_category ]
      original.call(*arguments)
    end
    get "/api/v1/payroll/cockpit/settlement_cases", headers: headers

    expect(response).to have_http_status(:ok)
    expect(source_entry_loads).to eq(1)
    expect(json.fetch(:settlement_cases)).to include(
      include(
        id: settlement_case.public_id,
        status: "open",
        source_time_entry_id: entry.id.to_s,
        routing: include(destination_kind: "unassigned", owner_role: "aire_admins")
      )
    )

    grant = PayrollIntegrationGrant.issue!(user: admin, capabilities: [ "settlement_case_management" ])
    command_headers = headers.merge("X-Aire-Delegation-Token" => grant.issued_token)
    command_id = SecureRandom.uuid
    payload = {
      command_id: command_id,
      expected_version: settlement_case.lock_version,
      destination_kind: "supplemental",
      target_external_pay_period_id: "cornerstone-supplemental-2026-10-01",
      action_due_on: "2026-10-28",
      assigned_to_id: admin.id,
      reason: "The payment deadline is before the next regular payroll"
    }

    post "/api/v1/payroll/cockpit/settlement_cases/#{settlement_case.public_id}/route",
         params: payload.to_json, headers: command_headers

    expect(response).to have_http_status(:ok)
    expect(json.dig(:settlement_case, :routing)).to include(
      destination_kind: "supplemental",
      target_external_pay_period_id: "cornerstone-supplemental-2026-10-01",
      action_due_on: "2026-10-28"
    )
    expect(json.dig(:settlement_case, :events).pluck(:event_type)).to eq(%w[routed])

    post "/api/v1/payroll/cockpit/settlement_cases/#{settlement_case.public_id}/route",
         params: payload.to_json, headers: command_headers

    expect(response).to have_http_status(:ok)
    expect(json.dig(:command, :replayed)).to be(true)
    expect(json).not_to have_key(:settlement_case)
  end

  it "rejects a regular route to a failed period that has no scheduled retry" do
    settlement_case = create(:payroll_settlement_case)
    target = create(
      :payroll_calendar_period,
      external_pay_period_id: "nonretryable-target",
      start_date: Date.new(2026, 11, 1),
      end_date: Date.new(2026, 11, 15),
      pay_date: Date.new(2026, 11, 25),
      cutoff_at: ActiveSupport::TimeZone["Pacific/Guam"].local(2026, 11, 18, 17),
      status: "failed",
      next_finalization_attempt_at: nil,
      last_finalization_error: "Requires operator review"
    )
    grant = PayrollIntegrationGrant.issue!(user: admin, capabilities: [ "settlement_case_management" ])

    post "/api/v1/payroll/cockpit/settlement_cases/#{settlement_case.public_id}/route",
         params: {
           command_id: SecureRandom.uuid,
           expected_version: settlement_case.lock_version,
           destination_kind: "regular",
           target_external_pay_period_id: target.external_pay_period_id,
           reason: "Try an unavailable regular payroll"
         }.to_json,
         headers: headers.merge("X-Aire-Delegation-Token" => grant.issued_token)

    expect(response).to have_http_status(:unprocessable_entity)
    expect(json.fetch(:error)).to include("future, unfinalized regular payroll period")
    expect(settlement_case.reload).to have_attributes(status: "open", destination_kind: "unassigned")
  end

  it "records source-linked supplemental payment acknowledgements in order without inferring settlement" do
    entry = create_entry
    settlement_case = create(
      :payroll_settlement_case,
      source_time_entry_id: entry.id,
      source_user_id: employee.id,
      source_user_uuid: employee.payroll_integration_uuid,
      destination_kind: "supplemental",
      target_external_pay_period_id: "supplemental-case-1",
      action_due_on: Date.new(2026, 10, 28),
      status: "scheduled"
    )
    grant = PayrollIntegrationGrant.issue!(user: admin, capabilities: [ "settlement_case_management" ])
    command_headers = headers.merge("X-Aire-Delegation-Token" => grant.issued_token)

    %w[imported committed payment_prepared].each_with_index do |event_type, index|
      post "/api/v1/payroll/cockpit/settlement_cases/#{settlement_case.public_id}/acknowledge",
           params: {
             command_id: SecureRandom.uuid,
             expected_version: settlement_case.reload.lock_version,
             event_type: event_type,
             occurred_at: format("2026-10-27T%02d:00:00+10:00", 9 + index),
             reason: "Cornerstone moved the supplemental item forward",
             metadata: { external_payroll_item_id: "item-42" }
           }.to_json,
           headers: command_headers
      expect(response).to have_http_status(:ok)
    end

    post "/api/v1/payroll/cockpit/settlement_cases/#{settlement_case.public_id}/acknowledge",
         params: {
           command_id: SecureRandom.uuid,
           expected_version: settlement_case.reload.lock_version,
           event_type: "payment_issued",
           occurred_at: "2026-10-27T12:00:00+10:00",
           reason: "Cornerstone released physical check 1042",
           metadata: {
             external_pay_period_id: "supplemental-case-1",
             external_payroll_item_id: "item-42",
             payment_method: "physical_check",
             payment_reference: "1042"
           }
         }.to_json,
         headers: command_headers

    expect(response).to have_http_status(:ok)
    expect(json.dig(:settlement_case, :status)).to eq("in_payroll")
    expect(json.dig(:settlement_case, :processing)).to include(
      status: "payment_issued",
      payment_method: "physical_check",
      payment_reference: "1042"
    )
    expect(json.dig(:settlement_case, :status)).not_to eq("settled")
  end

  it "rejects out-of-order settlement acknowledgements" do
    settlement_case = create(
      :payroll_settlement_case,
      destination_kind: "supplemental",
      target_external_pay_period_id: "supplemental-case-2",
      status: "scheduled"
    )
    grant = PayrollIntegrationGrant.issue!(user: admin, capabilities: [ "settlement_case_management" ])

    post "/api/v1/payroll/cockpit/settlement_cases/#{settlement_case.public_id}/acknowledge",
         params: {
           command_id: SecureRandom.uuid,
           expected_version: settlement_case.lock_version,
           event_type: "payment_issued",
           occurred_at: "2026-10-27T12:00:00+10:00",
           reason: "Invalid shortcut"
         }.to_json,
         headers: headers.merge("X-Aire-Delegation-Token" => grant.issued_token)

    expect(response).to have_http_status(:unprocessable_entity)
    expect(json.fetch(:error)).to include("record imported next")
    expect(settlement_case.reload.status).to eq("scheduled")
  end

  it "rejects a supplemental acknowledgement timestamp before the prior processing event" do
    settlement_case = create(
      :payroll_settlement_case,
      destination_kind: "supplemental",
      target_external_pay_period_id: "supplemental-case-3",
      status: "scheduled"
    )
    grant = PayrollIntegrationGrant.issue!(user: admin, capabilities: [ "settlement_case_management" ])
    command_headers = headers.merge("X-Aire-Delegation-Token" => grant.issued_token)

    post "/api/v1/payroll/cockpit/settlement_cases/#{settlement_case.public_id}/acknowledge",
         params: {
           command_id: SecureRandom.uuid,
           expected_version: settlement_case.lock_version,
           event_type: "imported",
           occurred_at: "2026-10-27T09:00:00+10:00",
           reason: "Cornerstone imported the supplemental item"
         }.to_json,
         headers: command_headers
    expect(response).to have_http_status(:ok)

    post "/api/v1/payroll/cockpit/settlement_cases/#{settlement_case.public_id}/acknowledge",
         params: {
           command_id: SecureRandom.uuid,
           expected_version: settlement_case.reload.lock_version,
           event_type: "committed",
           occurred_at: "2026-10-27T08:59:59+10:00",
           reason: "Invalid historical timestamp"
         }.to_json,
         headers: command_headers

    expect(response).to have_http_status(:unprocessable_entity)
    expect(json.fetch(:error)).to include("earlier than the previous processing event")
    expect(settlement_case.reload.payroll_settlement_case_events.pluck(:event_type)).to eq([ "imported" ])
  end

  it "corrects a missing punch through AIRE and requires a new explicit approval" do
    entry = create_entry(
      entry_method: "clock",
      approval_status: nil,
      status: "clocked_in",
      start_time: ActiveSupport::TimeZone["Pacific/Guam"].local(period.start_date.year, period.start_date.month, period.start_date.day, 8),
      end_time: nil,
      hours: 0
    )
    grant = PayrollIntegrationGrant.issue!(user: admin, capabilities: [ "time_correction" ])

    post "/api/v1/payroll/cockpit/time_entries/#{entry.id}/correction",
         params: {
           command_id: SecureRandom.uuid,
           expected_version: entry.lock_version,
           end_time: "17:00",
           breaks: [ { start_time: "12:00", end_time: "13:00" } ],
           reason: "Employee confirmed the missing clock-out"
         }.to_json,
         headers: headers.merge("X-Aire-Delegation-Token" => grant.issued_token)

    expect(response).to have_http_status(:ok)
    expect(json.dig(:time_entry, :state)).to include(approval_status: "pending")
    expect(json.dig(:time_entry, :state, :overtime_status)).to eq("none")
    expect(json.dig(:time_entry, :state, :missing_punch)).to be(false)
    expect(entry.reload).to have_attributes(status: "completed", approval_status: "pending", hours: 8.0, break_minutes: 60)
    expect(entry.time_entry_breaks.sole.duration_minutes).to eq(60)
    expect(AuditLog.find_by!(action: "payroll_cockpit.time_entry_corrected", auditable: entry).metadata)
      .to include("requires_approval" => true)
  end

  it "recalculates overtime from the corrected hours instead of requiring it unconditionally" do
    entry = create_entry(
      approval_status: "approved",
      overtime_status: "approved",
      start_time: ActiveSupport::TimeZone["Pacific/Guam"].local(period.start_date.year, period.start_date.month, period.start_date.day, 8),
      end_time: ActiveSupport::TimeZone["Pacific/Guam"].local(period.start_date.year, period.start_date.month, period.start_date.day, 17),
      hours: 9
    )
    grant = PayrollIntegrationGrant.issue!(user: admin, capabilities: [ "time_correction" ])

    post "/api/v1/payroll/cockpit/time_entries/#{entry.id}/correction",
         params: {
           command_id: SecureRandom.uuid,
           expected_version: entry.lock_version,
           end_time: "16:00",
           reason: "Corrected to the verified eight-hour shift"
         }.to_json,
         headers: headers.merge("X-Aire-Delegation-Token" => grant.issued_token)

    expect(response).to have_http_status(:ok)
    expect(entry.reload).to have_attributes(
      hours: 8.0,
      approval_status: "pending",
      overtime_status: "none",
      overtime_approved_by_id: nil,
      overtime_approved_at: nil,
      overtime_note: nil
    )

    post "/api/v1/payroll/cockpit/time_entries/#{entry.id}/correction",
         params: {
           command_id: SecureRandom.uuid,
           expected_version: entry.lock_version,
           end_time: "18:00",
           reason: "Corrected to the verified ten-hour shift"
         }.to_json,
         headers: headers.merge("X-Aire-Delegation-Token" => grant.issued_token)

    expect(response).to have_http_status(:ok)
    expect(entry.reload).to have_attributes(hours: 10.0, approval_status: "pending", overtime_status: "pending")
  end

  it "rolls back the entry and break replacement when correction auditing fails" do
    entry = create_entry(
      start_time: ActiveSupport::TimeZone["Pacific/Guam"].local(period.start_date.year, period.start_date.month, period.start_date.day, 8),
      end_time: ActiveSupport::TimeZone["Pacific/Guam"].local(period.start_date.year, period.start_date.month, period.start_date.day, 17),
      break_minutes: 30
    )
    original_break = entry.time_entry_breaks.create!(
      start_time: ActiveSupport::TimeZone["Pacific/Guam"].local(period.start_date.year, period.start_date.month, period.start_date.day, 12),
      end_time: ActiveSupport::TimeZone["Pacific/Guam"].local(period.start_date.year, period.start_date.month, period.start_date.day, 12, 30)
    )
    grant = PayrollIntegrationGrant.issue!(user: admin, capabilities: [ "time_correction" ])
    allow(AuditLog).to receive(:record!).and_wrap_original do |original, **attributes|
      if attributes[:action] == "payroll_cockpit.time_entry_corrected"
        invalid_audit = AuditLog.new
        invalid_audit.errors.add(:base, "simulated audit failure")
        raise ActiveRecord::RecordInvalid, invalid_audit
      end
      original.call(**attributes)
    end

    expect do
      post "/api/v1/payroll/cockpit/time_entries/#{entry.id}/correction",
           params: {
             command_id: SecureRandom.uuid,
             expected_version: entry.lock_version,
             end_time: "18:00",
             breaks: [ { start_time: "13:00", end_time: "14:00" } ],
             reason: "Attempt a correction that cannot be audited"
           }.to_json,
           headers: headers.merge("X-Aire-Delegation-Token" => grant.issued_token)
    end.not_to change(PayrollIntegrationCommand, :count)

    expect(response).to have_http_status(:unprocessable_entity)
    expect(entry.reload).to have_attributes(
      break_minutes: 30,
      approval_status: "pending"
    )
    expect(entry.formatted_end_time).to eq("5:00 PM")
    expect(entry.time_entry_breaks.reload.sole).to have_attributes(
      id: original_break.id,
      duration_minutes: 30
    )
  end

  it "enforces append-only command receipts in PostgreSQL" do
    entry = create_entry
    receipt = PayrollIntegrationCommand.create!(
      command_id: SecureRandom.uuid,
      action: "test.command",
      actor: admin,
      actor_payroll_integration_uuid: admin.payroll_integration_uuid,
      target_type: "TimeEntry",
      target_id: entry.id,
      expected_version: 0,
      request_checksum: Digest::SHA256.hexdigest("test"),
      response_status: 200,
      result_metadata: { ok: true }
    )

    expect do
      PayrollIntegrationCommand.where(id: receipt.id).update_all(response_status: 201)
    end.to raise_error(ActiveRecord::StatementInvalid, /append-only/)
  end

  it "prevents command receipts from being deleted in PostgreSQL" do
    entry = create_entry
    receipt = PayrollIntegrationCommand.create!(
      command_id: SecureRandom.uuid,
      action: "test.command",
      actor: admin,
      actor_payroll_integration_uuid: admin.payroll_integration_uuid,
      target_type: "TimeEntry",
      target_id: entry.id,
      expected_version: 0,
      request_checksum: Digest::SHA256.hexdigest("test"),
      response_status: 200,
      result_metadata: { ok: true }
    )

    expect do
      PayrollIntegrationCommand.where(id: receipt.id).delete_all
    end.to raise_error(ActiveRecord::StatementInvalid, /append-only/)
  end

  it "prevents the command receipt table from being truncated in PostgreSQL" do
    receipt = PayrollIntegrationCommand.create!(
      command_id: SecureRandom.uuid,
      action: "test.command",
      actor: admin,
      actor_payroll_integration_uuid: admin.payroll_integration_uuid,
      target_type: "User",
      target_id: admin.id,
      expected_version: 0,
      request_checksum: Digest::SHA256.hexdigest("test"),
      response_status: 200,
      result_metadata: { ok: true }
    )

    expect do
      ActiveRecord::Base.transaction(requires_new: true) do
        ActiveRecord::Base.connection.execute("TRUNCATE TABLE payroll_integration_commands")
      end
    end.to raise_error(ActiveRecord::StatementInvalid, /append-only/)
    expect(PayrollIntegrationCommand.exists?(receipt.id)).to be(true)
  end
end
