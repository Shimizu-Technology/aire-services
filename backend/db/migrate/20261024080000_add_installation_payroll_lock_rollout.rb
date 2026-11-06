# frozen_string_literal: true

class AddInstallationPayrollLockRollout < ActiveRecord::Migration[8.1]
  def up
    create_table :payroll_lock_rollouts do |t|
      t.date :cutoff_enforcement_starts_on, null: false
      t.string :configured_by, null: false
      t.text :reason, null: false
      t.timestamps
    end
    add_check_constraint :payroll_lock_rollouts, "id = 1", name: "payroll_lock_rollout_singleton"
    add_check_constraint :payroll_lock_rollouts,
      "EXTRACT(DAY FROM cutoff_enforcement_starts_on) IN (1, 16) AND length(trim(configured_by)) > 0 AND length(trim(reason)) >= 10",
      name: "payroll_lock_rollout_valid_configuration"
    execute <<~SQL
      CREATE FUNCTION protect_payroll_lock_rollout() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'installation payroll lock rollout is immutable';
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER payroll_lock_rollouts_immutable BEFORE UPDATE OR DELETE ON payroll_lock_rollouts
        FOR EACH ROW EXECUTE FUNCTION protect_payroll_lock_rollout();
      CREATE TRIGGER payroll_lock_rollouts_prevent_truncate BEFORE TRUNCATE ON payroll_lock_rollouts
        FOR EACH STATEMENT EXECUTE FUNCTION protect_payroll_lock_rollout();
    SQL

    # Preserve all published/frozen history. Only new publications derive mode
    # from the configured installation boundary; this is never an unlock tool.
    add_column :payroll_calendar_periods, :lock_mode, :string, null: false, default: "scheduled"
    add_column :payroll_calendar_periods, :cutoff_enforcement_starts_on, :date
    add_check_constraint :payroll_calendar_periods,
      "lock_mode IN ('manual', 'scheduled') AND ((cutoff_enforcement_starts_on IS NULL AND lock_mode = 'scheduled') OR (cutoff_enforcement_starts_on IS NOT NULL AND EXTRACT(DAY FROM cutoff_enforcement_starts_on) IN (1, 16) AND lock_mode = CASE WHEN start_date < cutoff_enforcement_starts_on THEN 'manual' ELSE 'scheduled' END))",
      name: "payroll_calendar_lock_mode_valid"
    execute <<~SQL
      CREATE FUNCTION protect_payroll_calendar_lock_mode() RETURNS trigger AS $$
      BEGIN
        IF NEW.lock_mode IS DISTINCT FROM OLD.lock_mode
          OR NEW.cutoff_enforcement_starts_on IS DISTINCT FROM OLD.cutoff_enforcement_starts_on THEN
          RAISE EXCEPTION 'published payroll calendar lock mode and activation are immutable';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER payroll_calendar_lock_mode_immutable BEFORE UPDATE ON payroll_calendar_periods
        FOR EACH ROW EXECUTE FUNCTION protect_payroll_calendar_lock_mode();
    SQL
  end

  def down
    raise ActiveRecord::IrreversibleMigration, "Preserve installation rollout decisions and published calendar modes"
  end
end
