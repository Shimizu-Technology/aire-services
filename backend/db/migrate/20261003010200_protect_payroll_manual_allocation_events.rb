# frozen_string_literal: true

class ProtectPayrollManualAllocationEvents < ActiveRecord::Migration[8.1]
  def change
    add_check_constraint :payroll_manual_allocation_events,
                         "event_type IN ('committed', 'issued', 'voided')",
                         name: "check_payroll_manual_allocation_events_type"

    reversible do |direction|
      direction.up do
        execute <<~SQL
          CREATE TRIGGER payroll_manual_allocation_events_append_only
          BEFORE UPDATE OR DELETE ON payroll_manual_allocation_events
          FOR EACH ROW EXECUTE FUNCTION protect_finalized_payroll_records();

          CREATE TRIGGER payroll_manual_allocation_events_prevent_truncate
          BEFORE TRUNCATE ON payroll_manual_allocation_events
          FOR EACH STATEMENT EXECUTE FUNCTION protect_finalized_payroll_records();
        SQL
      end

      direction.down do
        execute <<~SQL
          DROP TRIGGER IF EXISTS payroll_manual_allocation_events_append_only ON payroll_manual_allocation_events;
          DROP TRIGGER IF EXISTS payroll_manual_allocation_events_prevent_truncate ON payroll_manual_allocation_events;
        SQL
      end
    end
  end
end
