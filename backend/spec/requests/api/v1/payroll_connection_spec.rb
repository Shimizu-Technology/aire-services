# frozen_string_literal: true

require "rails_helper"
require_relative "../../../support/payroll_clock_helpers"

RSpec.describe "Payroll connection", type: :request do
  include ActiveSupport::Testing::TimeHelpers
  include PayrollClockHelpers

  let(:zone) { ActiveSupport::TimeZone["Pacific/Guam"] }
  let(:owner) { create(:user, :owner, first_name: "Leon", last_name: "Shimizu") }
  let(:admin) { create(:user, :admin, first_name: "Chels", last_name: "Admin") }
  let(:now) { zone.local(2026, 11, 11, 19, 30) }

  around { |example| travel_to(now) { example.run } }

  def headers_for(user)
    { "Authorization" => "Bearer test_token_#{user.id}" }
  end

  def connection(user = admin)
    get "/api/v1/payroll_connection", headers: headers_for(user)
    expect(response).to have_http_status(:ok)
    response.parsed_body
  end

  def period(start_date)
    create(:payroll_calendar_period, payroll_calendar_for(start_date))
  end

  def revision(calendar_period, version:, published_at:)
    PayrollCalendarPeriodRevision.create!(payroll_calendar_period: calendar_period, schedule_version: version, publication_id: SecureRandom.uuid,
                                          request_checksum: SecureRandom.hex(32), payload: {}, published_at: published_at)
  end

  def outbox(calendar_period, status:, occurred_at:, **attributes)
    PayrollOutboxEvent.create!(payroll_calendar_period: calendar_period, event_type: "payroll_batch.finalized",
                               occurred_at: occurred_at, delivery_status: status, **attributes)
  end

  it "reports a healthy connection: last publication, last delivery and who linked it" do
    october = period(Date.new(2026, 10, 16))
    november = period(Date.new(2026, 11, 1))
    revision(october, version: 1, published_at: zone.local(2026, 10, 2, 9))
    latest = revision(november, version: 2, published_at: zone.local(2026, 11, 11, 19, 5))
    outbox(october, status: "delivered", occurred_at: zone.local(2026, 11, 3, 17), delivered_at: zone.local(2026, 11, 3, 17, 1), delivery_attempts: 1)
    PayrollAccountLink.create!(user: owner, external_actor_id: "cs-1", external_actor_email: "leon@cornerstone.example", linked_at: zone.local(2026, 9, 1, 8))
    PayrollAccountLink.create!(user: admin, external_actor_id: "cs-2", external_actor_email: "chels@cornerstone.example", linked_at: zone.local(2026, 10, 5, 10))

    body = connection

    expect(body).to include("mode" => "enabled", "enabled" => true, "message" => nil, "state" => "connected", "active_link_count" => 2)
    expect(body.fetch("last_publication")).to include("start_date" => "2026-11-01", "schedule_version" => 2,
                                                      "publication_id" => latest.publication_id, "published_at" => "2026-11-11T19:05:00+10:00")
    expect(body.fetch("last_delivery")).to include("event_type" => "payroll_batch.finalized", "delivered_at" => "2026-11-03T17:01:00+10:00")
    expect(body.dig("last_delivery", "period")).to include("start_date" => "2026-10-16", "end_date" => "2026-10-31")
    expect(body.fetch("account_link")).to eq(
      "aire_user" => { "id" => admin.id, "full_name" => "Chels Admin" }, "payroll_user_email" => "chels@cornerstone.example",
      "linked_at" => "2026-10-05T10:00:00+10:00", "connected" => true
    )
    expect(body.fetch("undelivered")).to eq("count" => 0, "failed_count" => 0, "stuck_count" => 0, "events" => [])
  end

  it "counts every failed and stuck delivery, though it lists only the oldest 20" do
    october = period(Date.new(2026, 10, 16))
    23.times { |index| outbox(october, status: "failed", occurred_at: now - 3.hours + index.minutes) }
    4.times { |index| outbox(october, status: "pending", occurred_at: now - 1.hour + index.minutes) }
    outbox(october, status: "pending", occurred_at: now - 1.minute)

    undelivered = connection.fetch("undelivered")

    expect(undelivered).to include("count" => 28, "failed_count" => 23, "stuck_count" => 4)
    expect(undelivered.fetch("events").size).to eq(20)
    expect(undelivered.fetch("events")).to all(include("state" => "failed"))
  end

  it "lists failed and stuck deliveries, but not one still sending" do
    october = period(Date.new(2026, 10, 16))
    failed = outbox(october, status: "failed", occurred_at: now - 2.hours, delivery_attempts: 5, last_response_status: 503,
                             last_error: "Cornerstone returned HTTP 503", next_delivery_attempt_at: now + 10.minutes)
    stuck = outbox(october, status: "pending", occurred_at: now - 30.minutes)
    outbox(october, status: "pending", occurred_at: now - 1.minute)

    body = connection

    expect(body.fetch("state")).to eq("delivery_problem")
    expect(body.fetch("undelivered")).to include("count" => 3, "failed_count" => 1, "stuck_count" => 1)
    expect(body.dig("undelivered", "events").map { |event| [ event["event_id"], event["state"] ] }).to eq([
      [ failed.event_id, "failed" ], [ stuck.event_id, "stuck" ]
    ])
    expect(body.dig("undelivered", "events").first).to include("attempts" => 5, "last_response_status" => 503,
                                                              "last_error" => "Cornerstone returned HTTP 503")
  end

  it "reports a paused connection ahead of anything else" do
    previous = ENV["CONNECTED_PAYROLL_MODE"]
    ENV["CONNECTED_PAYROLL_MODE"] = "paused"
    outbox(period(Date.new(2026, 10, 16)), status: "pending", occurred_at: now - 1.day)

    body = connection(owner)

    expect(body).to include("mode" => "paused", "enabled" => false, "message" => "Connected payroll is paused", "state" => "paused")
    expect(body.dig("undelivered", "stuck_count")).to eq(1)
  ensure
    ENV["CONNECTED_PAYROLL_MODE"] = previous
  end

  it "has nothing to show before the first publication or link" do
    expect(connection).to include("state" => "connected", "last_publication" => nil, "last_delivery" => nil, "account_link" => nil,
                                  "active_link_count" => 0)
  end

  it "ignores revoked links" do
    PayrollAccountLink.create!(user: admin, external_actor_id: "cs-2", linked_at: now - 1.day).revoke!

    expect(connection).to include("account_link" => nil, "active_link_count" => 0)
  end

  it "is for owners and admins only" do
    connection(owner)
    connection(admin)
    [ create(:user, :manager), create(:user, :employee) ].each do |user|
      get "/api/v1/payroll_connection", headers: headers_for(user)
      expect(response).to have_http_status(:forbidden)
    end
  end
end
