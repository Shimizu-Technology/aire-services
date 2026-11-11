# frozen_string_literal: true

require "rails_helper"
require_relative "../../../support/payroll_cutoff_override_helpers"

RSpec.describe "Payroll lock time", type: :request do
  include ActiveSupport::Testing::TimeHelpers
  include PayrollCutoffOverrideHelpers

  let(:dates) { ended_period_dates }
  let(:base) { policy_publication(dates) }
  let(:period) { PayrollCalendarPeriod.find_by!(external_pay_period_id: base.fetch(:external_pay_period_id)) }
  let(:owner) { create(:user, :owner, first_name: "Leon", last_name: "Shimizu") }
  let(:admin) { create(:user, :admin, first_name: "Chels", last_name: "Admin") }
  let(:client) { instance_double(Payroll::CutoffChangeClient) }

  before do
    configure_lock_rollout!(dates)
    Payroll::CalendarPeriodPublisher.new(base).call
    allow(Payroll::CutoffChangeClient).to receive(:new).and_return(client)
  end

  def headers_for(user)
    { "Authorization" => "Bearer test_token_#{user.id}" }
  end

  def request_change(user, **params)
    post "/api/v1/payroll_cutoff/lock_time", headers: headers_for(user), as: :json, params: {
      external_pay_period_id: period.external_pay_period_id, publication_id: period.publication_id,
      lock_action: "lock_now", reason: "Approvals are done"
    }.merge(params)
  end

  it "shows the next lock and its controls to owners and admins only" do
    get "/api/v1/payroll_cutoff", headers: headers_for(admin)
    control = response.parsed_body.fetch("lock_control")
    expect(control).to include("cutoff_at" => Time.iso8601(base.fetch(:cutoff_at)).iso8601, "cutoff_source" => "policy",
      "can_change" => true, "can_lock_now" => true, "can_reset" => false, "override" => nil)
    expect(control.dig("period", "external_pay_period_id")).to eq(period.external_pay_period_id)

    [ create(:user, :manager), create(:user, :employee) ].each do |user|
      get "/api/v1/payroll_cutoff", headers: headers_for(user)
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).not_to have_key("lock_control")
      expect(response.parsed_body.fetch("cutoff")).to have_key("cutoff_at")
    end
  end

  it "asks Cornerstone on behalf of the signed-in owner and audits the request" do
    PayrollAccountLink.create!(user: owner, external_system: "cornerstone_payroll", external_actor_id: "1", linked_at: Time.current, active: true)
    allow(client).to receive(:request_change).and_return("override_id" => "abc", "cutoff_at" => Time.current.iso8601, "action" => "lock_now")

    request_change(owner, request_id: "11111111-2222-4333-8444-555555555555")

    expect(response).to have_http_status(:ok)
    expect(client).to have_received(:request_change).with(
      external_pay_period_id: period.external_pay_period_id, action: "lock_now", cutoff_at: nil, reason: "Approvals are done",
      actor: { system: "aire_services", user_id: owner.id, name: "Leon Shimizu", email: owner.email, role: "owner", payroll_user_id: "1" },
      request_id: "11111111-2222-4333-8444-555555555555"
    )
    audit = AuditLog.find_by!(action: "payroll_calendar_period.cutoff_change_requested")
    expect(audit).to have_attributes(user_id: owner.id, outcome: "succeeded", auditable_id: period.id)
    expect(audit.metadata).to include("requested_action" => "lock_now", "reason" => "Approvals are done", "cornerstone_override_id" => "abc")
    # AIRE itself changes only when Cornerstone republishes the period.
    expect(period.reload.cutoff_source).to eq("policy")
  end

  it "refuses managers and employees" do
    allow(client).to receive(:request_change)
    [ create(:user, :manager), create(:user, :employee) ].each do |user|
      request_change(user)
      expect(response).to have_http_status(:forbidden)
    end
    expect(client).not_to have_received(:request_change)
  end

  it "validates the request before calling Cornerstone" do
    allow(client).to receive(:request_change)
    latest = PayrollCalendarPeriod.latest_override_at(dates.fetch(:pay_date))
    {
      { reason: " " } => "Enter a reason for the change",
      { publication_id: SecureRandom.uuid } => "This pay period changed. Refresh and try again.",
      { lock_action: "change", cutoff_at: (latest + 1.minute).iso8601 } => "Choose a time at least two days before payday",
      { lock_action: "change", cutoff_at: "tomorrow" } => "Choose a valid lock time",
      { lock_action: "change", cutoff_at: 14.minutes.from_now.iso8601 } => "Choose a time at least 15 minutes from now",
      { lock_action: "reset" } => "This period already uses the default lock time",
      { lock_action: "reopen" } => "Choose lock now, change, or reset"
    }.each do |params, message|
      request_change(admin, **params)
      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.parsed_body).to eq("error" => message)
    end
    expect(client).not_to have_received(:request_change)
  end

  it "offers only times at least 15 minutes ahead and stops changes within 15 minutes of the lock" do
    get "/api/v1/payroll_cutoff", headers: headers_for(admin)
    earliest = Time.iso8601(response.parsed_body.dig("lock_control", "earliest_cutoff_at"))
    expect(earliest).to be >= 15.minutes.from_now.change(sec: 0)
    expect(earliest.sec).to eq(0)

    travel_to(period.cutoff_at - 14.minutes) do
      get "/api/v1/payroll_cutoff", headers: headers_for(admin)
      expect(response.parsed_body.fetch("lock_control")).to include("can_change" => false, "can_lock_now" => false,
        "unavailable_reason" => "AIRE locks these hours in under 15 minutes, so the lock time can no longer change")
    end
  end

  it "notes a change Cornerstone accepted until it arrives, and AIRE's refusal if it doesn't apply" do
    target = (Time.iso8601(base.fetch(:cutoff_at)) + 1.day).iso8601
    allow(client).to receive(:request_change).and_return(
      "override_id" => "abc", "cutoff_at" => target, "action" => "change", "publication" => { "schedule_version" => 2 }
    )
    request_change(admin, lock_action: "change", cutoff_at: target)
    expect(response.parsed_body.dig("lock_control", "pending_change")).to include(
      "state" => "pending", "action" => "change", "cutoff_at" => target, "requested_by_name" => "Chels Admin", "error" => nil
    )
    # AIRE keeps showing the lock it has applied.
    expect(response.parsed_body.dig("lock_control", "cutoff_at")).to eq(Time.iso8601(base.fetch(:cutoff_at)).iso8601)

    # The publication reached AIRE after its time.
    late = override_publication(base, cutoff_at: Time.current - 1.hour)
    previous_secret = ENV["PAYROLL_SHARED_SECRET"]
    ENV["PAYROLL_SHARED_SECRET"] = "lock-time-spec-secret"
    begin
      put "/api/v1/payroll/calendar_periods/#{period.external_pay_period_id}", params: late.except(:external_pay_period_id).to_json,
        headers: { "Content-Type" => "application/json", "X-Shared-Secret" => "lock-time-spec-secret" }
    ensure
      ENV["PAYROLL_SHARED_SECRET"] = previous_secret
    end
    expect(response).to have_http_status(:unprocessable_entity)
    expect(AuditLog.find_by!(action: "payroll_calendar_period.publication_rejected").metadata).to include("schedule_version" => 2)

    get "/api/v1/payroll_cutoff", headers: headers_for(admin)
    expect(response.parsed_body.dig("lock_control", "pending_change")).to include(
      "state" => "rejected", "error" => "cutoff_at must be in the future when published; this lock time had already passed when it reached AIRE"
    )
  end

  it "shows Cornerstone's refusal and records a failed request" do
    allow(client).to receive(:request_change).and_raise(Payroll::CutoffChangeClient::Rejected.new("This period's lock time has already passed", status: 409))
    request_change(admin)
    expect(response).to have_http_status(:conflict)
    expect(response.parsed_body).to eq("error" => "This period's lock time has already passed")

    allow(client).to receive(:request_change).and_raise(Payroll::CutoffChangeClient::Unavailable, "network")
    request_change(admin)
    expect(response).to have_http_status(:bad_gateway)
    expect(AuditLog.where(action: "payroll_calendar_period.cutoff_change_requested", outcome: "failed").count).to eq(2)
  end
end
