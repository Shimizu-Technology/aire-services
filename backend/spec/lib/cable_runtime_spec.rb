require "spec_helper"
require_relative "../../lib/cable_runtime"

RSpec.describe CableRuntime do
  describe ".adapter" do
    it "defaults to the in-process adapter for a single-instance deployment" do
      expect(described_class.adapter({})).to eq("async")
    end

    it "allows multi-instance deployments to opt in to Solid Cable" do
      expect(described_class.adapter("ACTION_CABLE_ADAPTER" => " Solid_Cable ")).to eq("solid_cable")
    end

    it "rejects unsupported adapters at boot" do
      expect {
        described_class.adapter("ACTION_CABLE_ADAPTER" => "redis")
      }.to raise_error(ArgumentError, /Unsupported ACTION_CABLE_ADAPTER/)
    end
  end
end
