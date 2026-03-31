# frozen_string_literal: true

require "rails_helper"

RSpec.describe PayrollReconciliationService do
  let(:employees) do
    [
      { "gross_pay" => 5000.00, "net_pay" => 3800.00, "tax_withheld" => 1200.00 },
      { "gross_pay" => 4000.00, "net_pay" => 3100.00, "tax_withheld" => 900.00 }
    ]
  end

  let(:payload) { { "employees" => employees } }

  describe "#call" do
    it "returns match when provided totals equal derived totals" do
      result = described_class.new(
        payload: payload,
        provided_totals: { total_gross: 9000.00, total_net: 6900.00, total_tax: 2100.00, employee_count: 2 }
      ).call

      expect(result).to be_match
      expect(result.details["total_gross"][:match]).to be true
      expect(result.details["total_net"][:match]).to be true
      expect(result.details["total_tax"][:match]).to be true
      expect(result.details["employee_count"][:match]).to be true
    end

    it "tolerates rounding difference within one cent" do
      result = described_class.new(
        payload: payload,
        provided_totals: { total_gross: 9000.01, total_net: 6900.00, total_tax: 2100.00 }
      ).call

      expect(result).to be_match
    end

    it "fails when difference exceeds tolerance" do
      result = described_class.new(
        payload: payload,
        provided_totals: { total_gross: 9999.00 }
      ).call

      expect(result).not_to be_match
      expect(result.details["total_gross"][:match]).to be false
      expect(result.details["total_gross"][:difference]).to eq(999.0)
    end

    it "fails when employee_count mismatches" do
      result = described_class.new(
        payload: payload,
        provided_totals: { employee_count: 3 }
      ).call

      expect(result).not_to be_match
    end

    it "skips fields not provided" do
      result = described_class.new(
        payload: payload,
        provided_totals: { total_gross: 9000.00 }
      ).call

      expect(result).to be_match
      expect(result.details.keys).to eq(["total_gross"])
    end

    it "handles empty employees array" do
      result = described_class.new(
        payload: { "employees" => [] },
        provided_totals: { total_gross: 0.0, employee_count: 0 }
      ).call

      expect(result).to be_match
    end
  end
end
