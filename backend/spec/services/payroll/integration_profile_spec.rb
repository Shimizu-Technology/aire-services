# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::IntegrationProfile do
  self.use_transactional_tests = false

  after do
    Setting.where(key: described_class::SOURCE_INSTANCE_SETTING_KEY).delete_all
  end

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

  it "returns one persisted installation identity under competing first use" do
    ready = Queue.new
    start = Queue.new
    workers = 2.times.map do
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          ready << true
          start.pop
          described_class.call
        end
      end
    end

    2.times { ready.pop }
    2.times { start << true }
    results = workers.map(&:value)

    expect(results.map { |result| result.fetch(:source_instance_id) }.uniq.one?).to eq(true)
    expect(described_class.call.fetch(:source_instance_id)).to eq(results.first.fetch(:source_instance_id))
    expect(Setting.where(key: described_class::SOURCE_INSTANCE_SETTING_KEY).count).to eq(1)
  end
end
