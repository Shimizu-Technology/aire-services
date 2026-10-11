# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::ObligationOwnerResolver do
  def event(id:, entry: 1, line: "line-1", period: "2", item: "1", status: "committed", day: 16, binding: nil)
    PayrollEntryProcessingEvent.new(id: id, payroll_batch_id: 1, source_time_entry_id: entry,
      source_line_key: line, external_system: "cornerstone_payroll", external_pay_period_id: period,
      external_payroll_item_id: item, status: status, occurred_at: Time.utc(2026, 8, day),
      payroll_obligation_correction: binding)
  end

  def binding(id:, period:, item:)
    PayrollObligationCorrection.new(id: id, external_system: "cornerstone_payroll",
      successor_pay_period_id: period, successor_payroll_item_id: item)
  end

  it "preserves independent ordinary line metadata alongside a corrected line" do
    old = event(id: 1, status: "payment_issued", day: 28)
    corrected = event(id: 2, period: "3", item: "2", day: 18, binding: binding(id: 10, period: "3", item: "2"))
    ordinary = event(id: 3, entry: 2, line: "line-2", period: "5", item: "9", status: "payment_issued", day: 20)
    expect(described_class.current_events([ old, corrected, ordinary ])).to eq([ corrected, ordinary ])
    expect(PayrollEntryProcessingEvent.latest([ old, corrected, ordinary ])).to eq(ordinary)
  end

  it "resolves two independent correction chains without choosing one global owner" do
    first = event(id: 1, period: "3", item: "2", binding: binding(id: 10, period: "3", item: "2"))
    second = event(id: 2, entry: 2, line: "line-2", period: "6", item: "8", binding: binding(id: 11, period: "6", item: "8"))
    old_first = event(id: 3, day: 28, status: "payment_issued")
    old_second = event(id: 4, entry: 2, line: "line-2", period: "4", item: "7", day: 28, status: "payment_issued")
    expect(described_class.current_events([ first, second, old_first, old_second ])).to eq([ first, second ])
  end

  it "keeps the actual previous corrective owner terminal across a later generation" do
    first = event(id: 1, period: "3", item: "2", day: 28, status: "payment_issued", binding: binding(id: 10, period: "3", item: "2"))
    second = event(id: 2, period: "4", item: "3", day: 20, binding: binding(id: 11, period: "4", item: "3"))
    expect(PayrollEntryProcessingEvent.latest([ first, second ])).to eq(second)
  end

  it "does not let a delayed ambiguous legacy receipt override a validated exact-line owner" do
    current = event(id: 1, period: "3", item: "2", binding: binding(id: 10, period: "3", item: "2"))
    legacy = event(id: 2, line: nil, day: 28, status: "payment_issued")
    expect(PayrollEntryProcessingEvent.latest([ current, legacy ])).to eq(current)
  end

  it "preserves pre-contract legacy reads without silently manufacturing a successor" do
    first = event(id: 1)
    second = event(id: 2, period: "9", item: "10", day: 20)
    expect(described_class.current_events([ first, second ])).to eq([ first, second ])
  end
end
