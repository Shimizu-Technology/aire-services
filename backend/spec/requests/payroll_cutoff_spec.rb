# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Payroll cutoff warnings", type: :request do
  include ActiveSupport::Testing::TimeHelpers

  let(:guam) { ActiveSupport::TimeZone["Pacific/Guam"] }
  let(:cutoff) { guam.local(2026, 11, 7, 17) }
  let(:employee) { create(:user, :kiosk_only) }
  let(:staff) { create(:user, :employee) }
  let(:admin) { create(:user, :admin) }
  let(:headers) { { "Authorization" => "Bearer test_token_#{staff.id}" } }
  let(:period_attributes) do
    { start_date: "2026-10-16", end_date: "2026-10-31", pay_date: "2026-11-15", cutoff_at: cutoff,
      schema_version: "2.0", cutoff_rule: "after_previous_regular_payday", previous_regular_pay_date: "2026-10-31" }
  end
  let!(:period) { create(:payroll_calendar_period, **period_attributes) }

  def read_cutoff
    get "/api/v1/payroll_cutoff", headers: headers
    expect(response).to have_http_status(:ok)
    response.parsed_body.fetch("cutoff")
  end

  around do |example|
    travel_to(guam.local(2026, 11, 6, 18)) { example.run }
  end

  prepend_before do
    PayrollLockRollout.configure!(starts_on: "2026-10-16", actor: "test", reason: "Warning activation")
  end

  { -86401 => "none", -86400 => "24h", -14401 => "24h", -14400 => "4h", -1 => "4h", 0 => "finalizing", 1 => "finalizing" }.each do |offset, stage|
    it "returns #{stage} at cutoff #{offset} seconds" do
      travel_to(cutoff + offset)
      result = read_cutoff
      expect(result.fetch("stage")).to eq(stage)
      expect(result.fetch("seconds_remaining")).to eq(-offset)
      expect(result.fetch("now")).to eq(Time.current.iso8601)
    end
  end

  it "uses the closing period across the UTC/Guam date boundary" do
    travel_to(Time.utc(2026, 11, 6, 14))
    expect(read_cutoff.dig("period", "start_date")).to eq("2026-10-16")
    expect(read_cutoff.fetch("stage")).to eq("24h")
  end

  context "with a manual period" do
    let(:period_attributes) do
      { start_date: "2026-10-01", end_date: "2026-10-15", pay_date: "2026-10-29",
        cutoff_at: guam.local(2026, 10, 22, 17), lock_mode: "manual", cutoff_enforcement_starts_on: "2026-10-16" }
    end

    it "never warns employees, including after a failed manual lock" do
      { "scheduled" => "manual", "failed" => "attention_required" }.each do |status, state|
        period.update!(status: status)
        [ period.cutoff_at - 4.hours, period.cutoff_at, period.cutoff_at + 1.minute ].each do |now|
          travel_to(now)
          expect(period.cutoff_state(now: now)).to eq(state)
          expect(period.as_contract_json(now: now).fetch(:cutoff_state)).to eq(state)
          expect(::Payroll::CutoffPresenter.call(now: now, period: period).fetch(:stage)).to eq("none")
          expect(PayrollCalendarPeriod.next_scheduled_cutoff_at).to be_nil
          expect(read_cutoff.fetch("stage")).to eq("none")
          expect(read_cutoff.fetch("period")).to be_nil
        end
      end
    end

    it "reports failed manual locks only to authenticated admins" do
      period.update!(status: "failed")
      get "/api/v1/payroll_cutoff", headers: headers
      expect(response.parsed_body).not_to have_key("attention")
      expect(response.parsed_body.dig("cutoff", "stage")).to eq("none")
      post "/api/v1/aire/kiosk/cutoff", params: { kiosk_access_token: AireKioskAccessToken.issue_for(admin) }
      expect(response.parsed_body).not_to have_key("attention")
      get "/api/v1/payroll_cutoff", headers: { "Authorization" => "Bearer test_token_#{admin.id}" }
      expect(response.parsed_body.fetch("attention")).to eq(
        "period" => { "id" => period.id, "start_date" => "2026-10-01", "end_date" => "2026-10-15" },
        "lock_mode" => "manual", "cutoff_state" => "attention_required"
      )
      expect(response.parsed_body.dig("cutoff", "stage")).to eq("none")
    end
  end

  { -86400 => "none", -14400 => "none", -1 => "none", 0 => "passed", 1 => "passed" }.each do |offset, stage|
    it "does not count down a failed scheduled period at cutoff #{offset} seconds" do
      period.update!(status: "failed", next_finalization_attempt_at: cutoff + 2.hours)
      travel_to(cutoff + offset)
      expect(period.cutoff_state(now: Time.current)).to eq("attention_required")
      # Discovery still points at the unresolved publication; state decides whether it warns.
      expect(PayrollCalendarPeriod.next_scheduled_cutoff_at).to eq(cutoff.iso8601)
      expect(read_cutoff.fetch("stage")).to eq(stage)
    end
  end

  it "rejects a pending acknowledgement after its period fails" do
    payload = read_cutoff.slice("publication_id", "version", "stage").merge("period_id" => period.id)
    period.update!(status: "failed")
    post "/api/v1/payroll_cutoff/acknowledge", params: payload, headers: headers
    expect(response).to have_http_status(:conflict)
    expect(read_cutoff.fetch("stage")).to eq("none")
  end

  it "returns only the safe contract and requires staff authentication" do
    result = read_cutoff
    expect(result.keys).to match_array(%w[period publication_id version now cutoff_at seconds_remaining time_zone stage])
    get "/api/v1/payroll_cutoff"
    expect(response).to have_http_status(:unauthorized)
    post "/api/v1/aire/kiosk/cutoff", params: { kiosk_access_token: "invalid" }
    expect(response).to have_http_status(:unauthorized)
  end

  it "persists acknowledgements across devices and invalidates on a changed stage" do
    payload = read_cutoff.slice("publication_id", "version", "stage").merge("period_id" => period.id)
    expect {
      post "/api/v1/payroll_cutoff/acknowledge", params: payload, headers: headers
      expect(response).to have_http_status(:ok)
      post "/api/v1/payroll_cutoff/acknowledge", params: payload, headers: headers
    }.to change(PayrollCutoffAcknowledgement, :count).by(1)
    get "/api/v1/payroll_cutoff", headers: headers
    expect(response.parsed_body.fetch("acknowledged")).to be(true)
    travel_to(cutoff - 4.hours)
    get "/api/v1/payroll_cutoff", headers: headers
    expect(response.parsed_body.fetch("acknowledged")).to be(false)
  end

  it "invalidates an acknowledged publication without changing the warning stage" do
    payload = read_cutoff.slice("publication_id", "version", "stage").merge("period_id" => period.id)
    expect(payload.fetch("stage")).to eq("24h")
    post "/api/v1/payroll_cutoff/acknowledge", params: payload, headers: headers
    expect(response).to have_http_status(:ok)
    get "/api/v1/payroll_cutoff", headers: headers
    expect(response.parsed_body.fetch("acknowledged")).to be(true)

    # Hold stage and optimistic-lock version constant to isolate publication identity.
    period.update_columns(publication_id: SecureRandom.uuid)
    get "/api/v1/payroll_cutoff", headers: headers
    expect(response.parsed_body.dig("cutoff", "stage")).to eq("24h")
    expect(response.parsed_body.dig("cutoff", "version")).to eq(payload.fetch("version"))
    expect(response.parsed_body.fetch("acknowledged")).to be(false)
    post "/api/v1/payroll_cutoff/acknowledge", params: payload, headers: headers
    expect(response).to have_http_status(:conflict)
  end

  it "isolates two kiosk employees and never changes their hours on acknowledgement" do
    other = create(:user, :kiosk_only)
    access = AireKioskAccessToken.issue_for(admin)
    payload = { kiosk_access_token: access, kiosk_token: AireKioskToken.issue_for(employee) }
    post "/api/v1/aire/kiosk/cutoff", params: payload
    expect(response).to have_http_status(:ok)
    identity = response.parsed_body.fetch("cutoff").slice("publication_id", "version", "stage").merge("period_id" => period.id)
    expect {
      post "/api/v1/aire/kiosk/cutoff/acknowledge", params: payload.merge(identity)
      expect(response).to have_http_status(:ok)
    }.not_to change(TimeEntry, :count)
    post "/api/v1/aire/kiosk/cutoff", params: payload.merge(kiosk_token: AireKioskToken.issue_for(other))
    expect(response.parsed_body.fetch("acknowledged")).to be(false)
    post "/api/v1/aire/kiosk/cutoff", params: { kiosk_access_token: access }
    expect(response.parsed_body.keys).to eq([ "cutoff" ])
  end
  it "shows passed only after a batch is finalized, and retains it before the next warning window" do
    batch = create(:payroll_batch)
    period.update!(status: "finalized", payroll_batch: batch, finalized_at: cutoff)
    travel_to(cutoff + 1.second)
    expect(read_cutoff.fetch("stage")).to eq("passed")
    create(:payroll_calendar_period)
    expect(read_cutoff.fetch("stage")).to eq("passed")
  end

  context "with a legacy scheduled period before activation" do
    let(:period_attributes) do
      { start_date: "2026-10-01", end_date: "2026-10-15", pay_date: "2026-10-29", cutoff_at: guam.local(2026, 10, 22, 17) }
    end

    it "excludes it from warning discovery" do
      expect(read_cutoff.fetch("period")).to be_nil
    end
  end

  it "rejects acknowledgements for other identities and revoked kiosk sessions" do
    payload = read_cutoff.slice("publication_id", "version", "stage").merge("period_id" => period.id)
    payload["version"] += 1
    post "/api/v1/payroll_cutoff/acknowledge", params: payload, headers: headers
    expect(response).to have_http_status(:conflict)
    access = AireKioskAccessToken.issue_for(admin)
    token = AireKioskToken.issue_for(employee)
    employee.update!(is_active: false)
    post "/api/v1/aire/kiosk/cutoff/acknowledge", params: payload.merge(kiosk_access_token: access, kiosk_token: token)
    expect(response).to have_http_status(:unauthorized)
    expect(PayrollCutoffAcknowledgement.count).to eq(0)
  end
  it "does not prevent removal of an otherwise unused staff profile" do
    payload = read_cutoff.slice("publication_id", "version", "stage").merge("period_id" => period.id)
    post "/api/v1/payroll_cutoff/acknowledge", params: payload, headers: headers
    expect(response).to have_http_status(:ok)
    expect { staff.destroy! }.to change(PayrollCutoffAcknowledgement, :count).by(-1)
  end
end
