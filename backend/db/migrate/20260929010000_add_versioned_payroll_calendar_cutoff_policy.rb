# frozen_string_literal: true

class AddVersionedPayrollCalendarCutoffPolicy < ActiveRecord::Migration[8.1]
  def up
    add_column :payroll_calendar_periods, :schema_version, :string, null: false, default: "1.0"
    add_column :payroll_calendar_periods, :cutoff_rule, :string, null: false, default: "before_pay_date"
    add_column :payroll_calendar_periods, :cutoff_days, :integer, null: false, default: 7
    add_column :payroll_calendar_periods, :previous_regular_pay_date, :date

    remove_check_constraint :payroll_calendar_periods, name: "check_payroll_calendar_period_cutoff_date"
    add_check_constraint :payroll_calendar_periods, <<~SQL.squish,
      schema_version IN ('1.0', '2.0')
      AND cutoff_rule IN ('before_pay_date', 'after_previous_regular_payday')
      AND cutoff_days BETWEEN 0 AND 31
      AND (
        (schema_version = '1.0' AND cutoff_rule = 'before_pay_date' AND cutoff_days = 7
          AND previous_regular_pay_date IS NULL
          AND (((cutoff_at AT TIME ZONE 'UTC') AT TIME ZONE 'Pacific/Guam')::date = pay_date - 7))
        OR
        (schema_version = '2.0' AND (
          (cutoff_rule = 'before_pay_date' AND previous_regular_pay_date IS NULL
            AND (((cutoff_at AT TIME ZONE 'UTC') AT TIME ZONE 'Pacific/Guam')::date = pay_date - cutoff_days))
          OR
          (cutoff_rule = 'after_previous_regular_payday'
            AND previous_regular_pay_date IS NOT NULL
            AND previous_regular_pay_date < pay_date
            AND previous_regular_pay_date + cutoff_days < pay_date
            AND (((cutoff_at AT TIME ZONE 'UTC') AT TIME ZONE 'Pacific/Guam')::date = previous_regular_pay_date + cutoff_days))
        ))
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
             OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
             OR NEW.cutoff_rule IS DISTINCT FROM OLD.cutoff_rule
             OR NEW.cutoff_days IS DISTINCT FROM OLD.cutoff_days
             OR NEW.previous_regular_pay_date IS DISTINCT FROM OLD.previous_regular_pay_date
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
    if select_value("SELECT EXISTS (SELECT 1 FROM payroll_calendar_periods WHERE schema_version <> '1.0')")
      raise ActiveRecord::IrreversibleMigration,
            "Version 2 payroll calendar periods exist; preserve them before rolling back this policy migration"
    end

    remove_check_constraint :payroll_calendar_periods, name: "check_payroll_calendar_period_cutoff_date"
    add_check_constraint :payroll_calendar_periods,
                         "(((cutoff_at AT TIME ZONE 'UTC') AT TIME ZONE 'Pacific/Guam')::date = pay_date - cutoff_days_before)",
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
    remove_column :payroll_calendar_periods, :previous_regular_pay_date
    remove_column :payroll_calendar_periods, :cutoff_days
    remove_column :payroll_calendar_periods, :cutoff_rule
    remove_column :payroll_calendar_periods, :schema_version
  end
end
