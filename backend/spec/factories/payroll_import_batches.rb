# frozen_string_literal: true

FactoryBot.define do
  factory :payroll_import_batch do
    sequence(:idempotency_key) { |n| "idem-key-#{n}" }
    sequence(:source_payroll_run_id) { |n| "run-#{n}" }
    payload do
      {
        "employees" => [
          { "name" => "Alice", "gross_pay" => 5000.00, "net_pay" => 3800.00, "tax_withheld" => 1200.00 },
          { "name" => "Bob", "gross_pay" => 4000.00, "net_pay" => 3100.00, "tax_withheld" => 900.00 }
        ]
      }
    end
    total_gross { 9000.00 }
    total_net { 6900.00 }
    total_tax { 2100.00 }
    employee_count { 2 }
    status { "pending" }

    trait :reconciled do
      status { "reconciled" }
    end

    trait :failed do
      status { "failed" }
      error_message { "Reconciliation mismatch" }
    end
  end
end
