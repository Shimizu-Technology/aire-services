# frozen_string_literal: true

class GuardManualCalendarFinalization < ActiveRecord::Migration[8.1]
  def up
    # Additive protection for mixed deployments: a pre-rollout worker still
    # sees status=scheduled, but cannot commit its nil-actor nominal snapshot.
    execute <<~SQL
      CREATE FUNCTION require_audited_manual_calendar_lock() RETURNS trigger AS $$
      BEGIN
        IF NEW.lock_mode = 'manual' AND NEW.status = 'finalized' THEN
          IF NOT EXISTS (
            SELECT 1 FROM payroll_batches batch
            JOIN users actor ON actor.id = batch.finalized_by_id
            JOIN audit_logs audit ON audit.auditable_type = 'PayrollBatch'
              AND audit.auditable_id = batch.id
              AND audit.action = 'payroll_batch.finalized'
              AND audit.user_id = actor.id
            WHERE batch.id = NEW.payroll_batch_id
              AND batch.start_date = NEW.start_date AND batch.end_date = NEW.end_date
              AND batch.finalized_at = batch.cutoff_at
              AND audit.metadata->>'manual_calendar_lock' = 'true'
              AND audit.metadata->>'automated_cutoff' = 'false'
              AND length(trim(audit.metadata->>'calendar_lock_reason')) > 0
          ) THEN
            RAISE EXCEPTION 'manual calendar finalization requires an explicit audited manual lock with a persisted actor and reason';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER payroll_calendar_manual_finalization_guard
        BEFORE INSERT OR UPDATE ON payroll_calendar_periods
        FOR EACH ROW EXECUTE FUNCTION require_audited_manual_calendar_lock();
    SQL
  end

  def down
    raise ActiveRecord::IrreversibleMigration, "Preserve manual lock protection during mixed deployments"
  end
end
