# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::CockpitPeriodSnapshot do
  let(:period) { create(:payroll_calendar_period) }
  let(:employee) { create(:user, :employee) }
  let(:category) { create(:time_category) }

  def entry_for(date)
    create(
      :time_entry,
      user: employee,
      time_category: category,
      work_date: date,
      entry_method: "clock",
      status: "completed",
      approval_status: nil
    )
  end

  it "reuses one complete preview while returning only the requested page state" do
    first = entry_for(period.start_date)
    second = entry_for(period.start_date + 1.day)
    cache = ActiveSupport::Cache::MemoryStore.new
    allow(Rails).to receive(:cache).and_return(cache)
    expect(Payroll::BatchBuilder).to receive(:new).once.and_call_original

    first_page = described_class.new(period: period, entries: [ first ]).call
    second_page = described_class.new(period: period, entries: [ second ]).call

    expect(first_page.entry_states.keys).to eq([ first.id ])
    expect(second_page.entry_states.keys).to eq([ second.id ])
    expect(first_page.entry_states.dig(first.id, :payable_now)).to be(true)
    expect(second_page.entry_states.dig(second.id, :payable_now)).to be(true)
  end
end
