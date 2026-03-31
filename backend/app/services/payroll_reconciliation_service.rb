# frozen_string_literal: true

# Compares provided totals against values derived from the line-item payload.
# Returns a result hash with :match (boolean) and :details (per-field breakdown).
#
# A rounding tolerance of 0.01 (one cent) is applied to each comparison
# to accommodate floating-point and cross-system rounding differences.
class PayrollReconciliationService
  TOLERANCE = BigDecimal("0.01")

  Result = Struct.new(:match, :details, keyword_init: true) do
    alias_method :match?, :match
  end

  def initialize(payload:, provided_totals:)
    payload_hash = (payload || {}).deep_stringify_keys
    @employees = payload_hash.fetch("employees", payload_hash.fetch("line_items", []))
    @provided = provided_totals.to_h.deep_stringify_keys
  end

  def call
    derived = derive_totals
    details = {}

    %w[total_gross total_net total_tax employee_count].each do |field|
      provided_val = @provided[field]
      derived_val  = derived[field]

      next if provided_val.nil?

      diff = (BigDecimal(provided_val.to_s) - BigDecimal(derived_val.to_s)).abs
      tolerance = field == "employee_count" ? 0 : TOLERANCE

      details[field] = {
        provided: provided_val.to_f,
        derived: derived_val.to_f,
        difference: diff.to_f,
        match: diff <= tolerance
      }
    end

    Result.new(
      match: details.values.all? { |d| d[:match] },
      details: details
    )
  end

  private

  def derive_totals
    {
      "total_gross"    => @employees.sum { |e| BigDecimal(e.fetch("gross_pay", 0).to_s) },
      "total_net"      => @employees.sum { |e| BigDecimal(e.fetch("net_pay", 0).to_s) },
      "total_tax"      => @employees.sum { |e| total_tax_for_employee(e) },
      "employee_count" => BigDecimal(@employees.size)
    }
  end

  def total_tax_for_employee(employee_hash)
    if employee_hash.key?("tax_withheld")
      return BigDecimal(employee_hash.fetch("tax_withheld", 0).to_s)
    end

    fields = %w[withholding_tax social_security_tax medicare_tax employer_social_security_tax employer_medicare_tax additional_withholding]
    fields.sum { |k| BigDecimal(employee_hash.fetch(k, 0).to_s) }
  end
end
