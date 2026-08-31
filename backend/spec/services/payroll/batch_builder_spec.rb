# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::BatchBuilder do
  let(:builder) { described_class.new(start_date: "2026-08-16", end_date: "2026-08-31") }
  let(:user) { create(:user, :employee) }
  let(:category) { create(:time_category) }
  let(:entry) do
    create(
      :time_entry,
      user: user,
      time_category: category,
      work_date: Date.new(2026, 8, 15),
      hours: 6
    )
  end
  let(:legacy_snapshot) do
    {
      "employee_name" => user.full_name,
      "effective_rate_cents" => 3_500,
      "nested" => { "hourly_rate_cents" => 3_500, "keep" => "audit context" }
    }
  end
  let(:latest) do
    PayrollBatchEntry.new(
      payroll_batch: PayrollBatch.new(cutoff_at: Time.current),
      source_time_entry_id: entry.id,
      source_user_id: user.id,
      source_category_id: category.id,
      work_date: entry.work_date,
      week_start: entry.work_date.beginning_of_week(:sunday),
      total_hours: 8,
      regular_hours: 8,
      overtime_hours: 0,
      source_kind: "current",
      line_key: "category:#{category.id}",
      snapshot: legacy_snapshot
    )
  end

  it "removes legacy compensation fields when copying a correction snapshot" do
    row = builder.send(
      :row_for_prior_dimension,
      entry,
      { total_hours: -2, regular_hours: -2, overtime_hours: 0 },
      latest,
      latest.line_key
    )

    expect(row.fetch(:snapshot)).to include("employee_name" => user.full_name)
    expect(row.dig(:snapshot, "nested")).to eq("keep" => "audit context")
    expect(row.fetch(:snapshot).to_json).not_to match(/(?:effective|hourly)_rate/)
  end

  it "removes legacy compensation fields when copying a deleted-entry snapshot" do
    row = builder.send(:deleted_rows_for, entry.id, [ latest ]).first

    expect(row.fetch(:snapshot)).to include("deleted_after_prior_batch" => true)
    expect(row.fetch(:snapshot).to_json).not_to match(/(?:effective|hourly)_rate/)
  end
end
