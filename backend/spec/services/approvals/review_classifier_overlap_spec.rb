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
end
