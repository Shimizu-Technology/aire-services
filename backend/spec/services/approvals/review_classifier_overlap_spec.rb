# frozen_string_literal: true

require "rails_helper"
require_relative "../../support/review_batch_helpers"

# Overlapping shifts can't both be paid, so each one needs a look and is never
# included in an Approve all batch.
RSpec.describe Approvals::ReviewClassifier, type: :service do
  include ActiveSupport::Testing::TimeHelpers
  include ReviewBatchHelpers

  let(:review_category) { create(:time_category) }
  let(:employee) { create(:user, :employee, first_name: "Marcus", last_name: "Quinata") }
  let(:other) { create(:user, :employee, first_name: "Ethan", last_name: "Cruz") }
  let(:manager) { create(:user, :manager, first_name: "Roke", last_name: "Aguon") }
  let(:friday) { Date.new(2026, 4, 10) }

  around { |example| travel_to(ReviewBatchHelpers::ZONE.local(2026, 4, 11, 18)) { example.run } }

  def keys_for(entries)
    described_class.call(Array(entries).map(&:reload), viewer: manager).transform_values { |row| row[:exceptions].map { |item| item[:key] } }
  end

  it "flags both of a person's overlapping shifts with 'Overlaps another shift'" do
    clocked = clock_shift(employee, friday, from: 6, hours: 8)
    added = create(:time_entry, user: employee, time_category: review_category, work_date: friday, entry_method: "manual",
                   start_time: ReviewBatchHelpers::ZONE.local(2000, 1, 1, 8), end_time: ReviewBatchHelpers::ZONE.local(2000, 1, 1, 16, 30),
                   hours: 8.5, approval_status: "pending")

    result = described_class.call([ clocked.reload, added.reload ], viewer: manager)

    expect(result.fetch(clocked.id)).to include(review_kind: "needs_look", exceptions: [ { key: "overlaps", label: "Overlaps another shift" } ])
    expect(result.fetch(added.id)[:exceptions].map { |row| row[:key] }).to include("overlaps")
  end

  it "catches an overlap with a shift outside the loaded list, including an overnight one" do
    clock_shift(employee, friday - 1, from: 22, hours: 8, approval_status: "approved")
    morning = clock_shift(employee, friday, from: 5, hours: 4)

    expect(keys_for(morning).fetch(morning.id)).to eq([ "overlaps" ])
  end

  it "leaves back-to-back shifts, other people's shifts and denied shifts alone" do
    first = clock_shift(employee, friday, from: 6, hours: 4)
    second = clock_shift(employee, friday, from: 10, hours: 4)
    clock_shift(other, friday, from: 7, hours: 8)
    clock_shift(employee, friday, from: 12, hours: 4, approval_status: "denied")

    expect(keys_for([ first, second ]).values).to all(be_empty)
  end

  describe "auto-approval at clock-out" do
    let(:zone) { ReviewBatchHelpers::ZONE }
    let(:worker) { create(:user, :employee, first_name: "Ana", time_tracking_enabled: true, kiosk_enabled: true) }

    before do
      worker.user_time_categories.create!(time_category: review_category)
      Setting.set(Setting::AUTO_APPROVE_ORDINARY_SHIFTS_KEY, "true")
    end

    def clock(from_hour, hours)
      travel_to zone.local(2026, 4, 10, from_hour)
      TimeClockService.clock_in(user: worker, time_category_id: review_category.id, clock_source: "mobile")
      travel hours.hours
      TimeClockService.clock_out(user: worker)
      TimeEntry.where(user: worker).order(:id).last
    end

    it "leaves a clock-out that overlaps an approved shift pending, with the overlap reason" do
      create(:time_entry, user: worker, time_category: review_category, work_date: friday, entry_method: "manual",
                          start_time: zone.local(2000, 1, 1, 8), end_time: zone.local(2000, 1, 1, 10), hours: 2, approval_status: "approved")

      overlapping = clock(9, 2)

      expect(overlapping).to have_attributes(approval_status: "pending")
      expect(AuditLog.where(action: "time_entry.auto_approved", auditable_id: overlapping.id)).to be_empty
      expect(TimeClockService.ordinary_shift_exceptions(overlapping)).to include(:overlaps)
      expect(keys_for(overlapping).fetch(overlapping.id)).to include("overlaps")
    end

    it "still auto-approves an ordinary clock-out that overlaps nothing" do
      create(:time_entry, user: worker, time_category: review_category, work_date: friday, entry_method: "manual",
                          start_time: zone.local(2000, 1, 1, 8), end_time: zone.local(2000, 1, 1, 10), hours: 2, approval_status: "approved")

      ordinary = clock(10, 2)

      expect(ordinary).to have_attributes(approval_status: "approved", approval_note: TimeEntry::AUTO_APPROVAL_NOTE)
    end
  end
end
