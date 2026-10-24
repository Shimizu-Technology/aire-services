# frozen_string_literal: true

class ProtectPayrollManualAllocations < ActiveRecord::Migration[8.1]
  def up
    # Reservation history has no deletion state. Keep its source projection
    # durable too; releasing hours must use the recorded void transition.
    execute <<~SQL
      CREATE TRIGGER payroll_manual_allocations_prevent_delete
      BEFORE DELETE ON payroll_manual_allocations
      FOR EACH ROW EXECUTE FUNCTION protect_finalized_payroll_records();

      CREATE TRIGGER payroll_manual_allocations_prevent_truncate
      BEFORE TRUNCATE ON payroll_manual_allocations
      FOR EACH STATEMENT EXECUTE FUNCTION protect_finalized_payroll_records();
    SQL
  end

  def down
    raise ActiveRecord::IrreversibleMigration, "Preserve durable reservations; release hours through a recorded void"
  end
end
