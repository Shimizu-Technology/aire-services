# frozen_string_literal: true

require "rails_helper"
require_relative "../../support/review_batch_helpers"

RSpec.describe Approvals::ReviewClassifier, type: :service do
  include ActiveSupport::Testing::TimeHelpers
  include ReviewBatchHelpers

  let(:review_category) { create(:time_category) }
  let(:employee) { create(:user, :employee, first_name: "Marcus", last_name: "Quinata") }
  let(:other) { create(:user, :employee, first_name: "Ethan", last_name: "Cruz") }
  let(:manager) { create(:user, :manager, first_name: "Roke", last_name: "Aguon") }
  let(:other_manager) { create(:user, :manager, first_name: "Mindy", last_name: "Diaz") }
  let(:admin) { create(:user, :admin, first_name: "Chels") }
  let(:wednesday) { Date.new(2026, 4, 8) }

  around { |example| travel_to(ReviewBatchHelpers::ZONE.local(2026, 4, 10, 18)) { example.run } }

  def classify(entries, viewer: manager)
    described_class.call(Array(entries).map(&:reload), viewer: viewer)
  end

  def keys_for(entry, viewer: manager)
    classify(entry, viewer: viewer).fetch(entry.id)[:exceptions].map { |row| row[:key] }
  end

  it "calls a completed kiosk or mobile shift with no exceptions ordinary" do
    kiosk = clock_shift(employee, wednesday)
    mobile = clock_shift(other, wednesday, clock_source: "mobile")
    result = classify([ kiosk, mobile ])
    expect(result.values).to all(eq(review_kind: "ordinary", exceptions: []))
  end

  it "flags overtime, counting earlier waiting shifts as if approved" do
    [ 5, 6, 7 ].each { |day| clock_shift(other, Date.new(2026, 4, day), from: 6, hours: 12) }
    wednesday_shift = clock_shift(other, wednesday)
    expect(classify(wednesday_shift).fetch(wednesday_shift.id)).to include(review_kind: "needs_look")
    expect(keys_for(wednesday_shift)).to eq([ "overtime" ])
  end

  it "flags the viewer's own time, and says another approver is needed when the policy is off" do
    own = clock_shift(manager, wednesday, approval_note: "Clocked in without a schedule | Supervisor's own time")
    expect(keys_for(own)).to eq([ "own_time" ])

    Setting.set(Setting::MANAGERS_CAN_APPROVE_OWN_TIME_KEY, "false")
    expect(keys_for(own)).to eq([ "own_time", "needs_another_approver" ])
    expect(keys_for(own, viewer: admin)).to eq([ "supervisor_own_time" ])
  end

  it "names who added a shift by hand and who edited one" do
    added = create(:time_entry, user: employee, time_category: review_category, work_date: wednesday, entry_method: "manual", approval_status: "pending")
    AuditLog.record!(action: "time_entry.created", auditable: added, actor: other_manager, metadata: { employee_id: employee.id })
    edited = clock_shift(other, wednesday)
    AuditLog.record!(action: "time_entry.updated", auditable: edited, actor: admin, metadata: { employee_id: other.id })

    result = classify([ added, edited ])
    expect(result.fetch(added.id)[:exceptions]).to eq([ { key: "added", label: "Added by Mindy Diaz" } ])
    expect(result.fetch(edited.id)[:exceptions]).to eq([ { key: "edited", label: "Edited by Chels User" } ])
  end

  it "flags corrected clock-outs, supervisor clocks, long shifts and missing categories" do
    corrected = clock_shift(employee, wednesday, approval_note: "Clocked in without a schedule | Employee corrected clock-out time to 05:00 PM")
    supervised = clock_shift(other, wednesday, clock_source: "admin")
    long = clock_shift(employee, Date.new(2026, 4, 9), from: 4, hours: 13)
    expect(keys_for(corrected)).to eq([ "corrected_clock_out" ])
    expect(keys_for(supervised)).to eq([ "clocked_by_supervisor" ])
    expect(classify(long).fetch(long.id)[:exceptions]).to eq([ { key: "over_max_hours", label: "Over 12h" } ])
  end

  it "flags a shift that crosses into the next pay period" do
    overnight = clock_shift(employee, Date.new(2026, 4, 15), from: 20, hours: 8)
    travel_to(ReviewBatchHelpers::ZONE.local(2026, 4, 17, 8))
    expect(keys_for(overnight)).to eq([ "crosses_period" ])
  end

  it "flags hours in a pay period whose lock has passed" do
    allow(ConnectedPayrollMode).to receive(:enabled?).and_return(true)
    create(:payroll_calendar_period, start_date: Date.new(2026, 4, 1), end_date: Date.new(2026, 4, 15), pay_date: Date.new(2026, 4, 20),
      cutoff_at: ReviewBatchHelpers::ZONE.local(2026, 4, 13, 17))
    late = clock_shift(employee, wednesday)
    travel_to(ReviewBatchHelpers::ZONE.local(2026, 4, 14, 8))
    expect(keys_for(late)).to eq([ "after_lock" ])
  end

  it "gives every segment of a switched shift the same answer" do
    first = clock_shift(employee, wednesday, from: 8, hours: 4)
    second = clock_shift(employee, wednesday, from: 12, hours: 9)
    expect(classify([ first, second ]).values.map { |row| row[:exceptions].map { |item| item[:key] } }).to eq([ [ "over_max_hours" ], [ "over_max_hours" ] ])
  end

  it "uses a fixed number of queries however many shifts are loaded" do
    few = [ clock_shift(employee, wednesday) ]
    queries = ->(entries) do
      loaded = TimeEntry.where(id: entries.map(&:id)).preload(:user, :time_entry_breaks).to_a
      count = 0
      callback = ->(*, payload) { count += 1 unless payload[:name] == "SCHEMA" || payload[:sql].start_with?("SAVEPOINT", "RELEASE") }
      ActiveSupport::Notifications.subscribed(callback, "sql.active_record") { described_class.call(loaded, viewer: manager) }
      count
    end
    baseline = queries.call(few)
    many = few + 12.times.map { |index| clock_shift(create(:user, :employee), wednesday, from: 6 + (index % 3)) }
    expect(queries.call(many)).to be <= baseline + 2
  end

  it "agrees with the auto-approve rules TimeClockService uses at clock-out" do
    Setting.set(Setting::AUTO_APPROVE_ORDINARY_SHIFTS_KEY, "true")
    ordinary = clock_shift(employee, wednesday)
    long = clock_shift(other, wednesday, from: 4, hours: 13)
    expect(TimeClockService.ordinary_shift_exceptions(ordinary.reload)).to eq([])
    expect(TimeClockService.ordinary_shift_exceptions(long.reload)).to eq([ :too_long ])
    expect(classify([ ordinary, long ]).transform_values { |row| row[:review_kind] }).to eq(ordinary.id => "ordinary", long.id => "needs_look")
  end
end
