require "spec_helper"
require_relative "../../lib/queue_runtime"

RSpec.describe QueueRuntime do
  describe ".adapter" do
    it "defaults to inline job execution" do
      expect(described_class.adapter({})).to eq("inline")
    end

    it "accepts supported adapters case-insensitively" do
      expect(described_class.adapter("ACTIVE_JOB_QUEUE_ADAPTER" => " Solid_Queue ")).to eq("solid_queue")
    end

    it "rejects unsupported adapters at boot" do
      expect {
        described_class.adapter("ACTIVE_JOB_QUEUE_ADAPTER" => "unknown")
      }.to raise_error(ArgumentError, /Unsupported ACTIVE_JOB_QUEUE_ADAPTER/)
    end
  end

  describe ".solid_queue_in_puma?" do
    it "requires both the Solid Queue adapter and an explicit truthy Puma flag" do
      expect(described_class.solid_queue_in_puma?(
        "ACTIVE_JOB_QUEUE_ADAPTER" => "solid_queue",
        "SOLID_QUEUE_IN_PUMA" => "true"
      )).to be(true)
    end

    it "does not treat the string false as enabled" do
      expect(described_class.solid_queue_in_puma?(
        "ACTIVE_JOB_QUEUE_ADAPTER" => "solid_queue",
        "SOLID_QUEUE_IN_PUMA" => "false"
      )).to be(false)
    end

    it "does not boot the supervisor for an inline adapter" do
      expect(described_class.solid_queue_in_puma?(
        "ACTIVE_JOB_QUEUE_ADAPTER" => "inline",
        "SOLID_QUEUE_IN_PUMA" => "true"
      )).to be(false)
    end
  end
end
