# frozen_string_literal: true

class AddPayDateCutoffPolicy < ActiveRecord::Migration[8.1]
  def up
    add_column :payroll_calendar_periods, :cutoff_policy, :string, null: false, default: "before_current_pay_date"
    add_column :payroll_calendar_periods, :cutoff_days_after_pay_date, :integer
    remove_check_constraint :payroll_calendar_periods, name: "check_payroll_calendar_period_cutoff_date"
    add_check_constraint :payroll_calendar_periods, <<~SQL.squish,
      (
        cutoff_policy = 'before_current_pay_date'
        AND cutoff_days_after_pay_date IS NULL
        AND (((cutoff_at AT TIME ZONE 'UTC') AT TIME ZONE 'Pacific/Guam')::date = pay_date - cutoff_days_before)
      ) OR (
        cutoff_policy = 'after_regular_pay_date'
        AND cutoff_days_after_pay_date = 7
        AND (((cutoff_at AT TIME ZONE 'UTC') AT TIME ZONE 'Pacific/Guam')::date = pay_date + cutoff_days_after_pay_date)
        AND (((cutoff_at AT TIME ZONE 'UTC') AT TIME ZONE 'Pacific/Guam')::time = TIME '17:00:00')
      )
    SQL
      name: "check_payroll_calendar_period_cutoff_date"

    execute <<~SQL
      CREATE OR REPLACE FUNCTION protect_payroll_calendar_period_after_cutoff()
      RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'payroll calendar periods cannot be deleted';
        END IF;
        IF OLD.status = 'finalized' THEN
          RAISE EXCEPTION 'finalized payroll calendar periods are immutable';
        END IF;
        IF (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') >= OLD.cutoff_at
           AND (
             NEW.external_pay_period_id IS DISTINCT FROM OLD.external_pay_period_id
             OR NEW.start_date IS DISTINCT FROM OLD.start_date
             OR NEW.end_date IS DISTINCT FROM OLD.end_date
             OR NEW.pay_date IS DISTINCT FROM OLD.pay_date
             OR NEW.cutoff_at IS DISTINCT FROM OLD.cutoff_at
             OR NEW.time_zone IS DISTINCT FROM OLD.time_zone
             OR NEW.cutoff_days_before IS DISTINCT FROM OLD.cutoff_days_before
             OR NEW.cutoff_policy IS DISTINCT FROM OLD.cutoff_policy
             OR NEW.cutoff_days_after_pay_date IS DISTINCT FROM OLD.cutoff_days_after_pay_date
             OR NEW.schedule_version IS DISTINCT FROM OLD.schedule_version
             OR NEW.publication_id IS DISTINCT FROM OLD.publication_id
             OR NEW.request_checksum IS DISTINCT FROM OLD.request_checksum
           ) THEN
          RAISE EXCEPTION 'payroll calendar schedules cannot change after cutoff';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    SQL
  end

  def down
    raise ActiveRecord::IrreversibleMigration,
          "New-policy periods must be reconciled before reverting the cutoff policy"
  end
end
