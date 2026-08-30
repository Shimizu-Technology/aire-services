# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::CanonicalPayload do
  it "produces the same checksum regardless of object key order" do
    first = { summary: { hours: 8.0, employees: 1 }, rows: [ { id: "1", hours: 8.0 } ] }
    reordered = { "rows" => [ { "hours" => 8.0, "id" => "1" } ], "summary" => { "employees" => 1, "hours" => 8.0 } }

    expect(described_class.checksum(first)).to eq(described_class.checksum(reordered))
  end
end
