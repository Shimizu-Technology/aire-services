# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::IntegrationProfile do
  it "creates one durable installation identity and declares supported contracts" do
    first = described_class.call
    second = described_class.call

    expect(first).to eq(second)
    expect(first).to include(
      protocol: "shimizu_time_payroll",
      protocol_version: "1.0",
      source_type: "aire_services"
    )
    expect(first.fetch(:source_instance_id)).to match(Payroll::IntegrationProfile::UUID_PATTERN)
    expect(first.fetch(:capabilities)).to include("time_summary_v1", "finalized_batch_v2", "exact_line_receipts_v2")
    expect(Setting.where(key: "payroll_source_instance_id").count).to eq(1)
  end

  it "fails closed instead of silently replacing an invalid saved identity" do
    Setting.create!(key: "payroll_source_instance_id", value: "not-a-uuid")

    expect { described_class.call }.to raise_error(/source instance identity is invalid/i)
    expect(Setting.find_by!(key: "payroll_source_instance_id").value).to eq("not-a-uuid")
  end
end
