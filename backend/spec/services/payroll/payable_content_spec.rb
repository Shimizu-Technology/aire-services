# frozen_string_literal: true

require "spec_helper"
require_relative "../../../app/services/payroll/payable_content"

RSpec.describe Payroll::PayableContent do
  it "does not mistake a legacy inferred category for a persisted source edit" do
    entry = double(time_category_id: nil)
    snapshot = { "time_category" => { "id" => 123 }, "time_category_inferred_from_sole_assignment" => true }
    expect(described_class.changed_from_snapshot?(entry, snapshot)).to be(false)
  end

  it "still detects an explicit category that differs from the inferred historical dimension" do
    entry = double(time_category_id: 456)
    snapshot = { "time_category" => { "id" => 123 }, "time_category_inferred_from_sole_assignment" => true }
    expect(described_class.changed_from_snapshot?(entry, snapshot)).to be(true)
  end

  it "compares persisted categories when the historical snapshot did not infer them" do
    snapshot = { "time_category" => { "id" => 123 } }
    expect(described_class.changed_from_snapshot?(double(time_category_id: 123), snapshot)).to be(false)
    expect(described_class.changed_from_snapshot?(double(time_category_id: 456), snapshot)).to be(true)
  end
end
