# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::WeeklyOvertimeReview do
  let(:employee) { create(:user, :employee) }
  let(:category) { create(:time_category) }

  def entry(date:, hours: 8, overtime_status: "pending")
    create(:time_entry, user: employee, time_category: category,
                        work_date: date, entry_method: "clock", approval_status: nil,
                        overtime_status: overtime_status,
                        start_time: Time.utc(2000, 1, 1, 0), end_time: Time.utc(2000, 1, 1, 0) + hours.hours)
  end

  it "loads each employee-week together and reallocates once rather than per flagged entry" do
    entries = 6.times.map { |offset| entry(date: Date.new(2026, 5, 3) + offset) }
    expect(TimeEntry).to receive(:countable).once.and_call_original
    expect(Payroll::WeeklyOvertimeAllocator).to receive(:call).once.and_call_original
    expect(described_class.call(entries)).to eq(entries.each_with_index.to_h { |record, index| [ record.id, index == 5 ] })
  end

  it "reuses complete report allocations without querying or allocating the same week again" do
    records = [ entry(date: Date.new(2026, 5, 3)), entry(date: Date.new(2026, 5, 4)) ]
    allocations = Payroll::WeeklyOvertimeAllocator.call(records)
    expect(TimeEntry).not_to receive(:countable)
    expect(Payroll::WeeklyOvertimeAllocator).not_to receive(:call)
    expect(described_class.call(records, allocations: allocations)).to eq(records.index_with { false }.transform_keys(&:id))
  end

  it "refreshes on every call after source hours change instead of keeping a stale cache" do
    records = 5.times.map { |offset| entry(date: Date.new(2026, 5, 3) + offset) }
    target = entry(date: Date.new(2026, 5, 8), hours: 1)
    expect(described_class.call([ target ])).to eq(target.id => true)
    records.first.update!(end_time: records.first.start_time + 4.hours)
    expect(described_class.call([ target ])).to eq(target.id => false)
  end
end
