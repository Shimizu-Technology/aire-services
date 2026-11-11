# frozen_string_literal: true

# Cornerstone Payroll may publish an admin-approved lock time that differs from
# the policy cutoff. The policy date check moves to policy_cutoff_at for those
# rows, so cutoff_days keeps meaning the policy rule instead of being rederived
# from an exceptional lock time.
class AddPayrollCutoffOverrides < ActiveRecord::Migration[8.1]
  POLICY_DATE_CHECK = <<~SQL.squish
    schema_version IN ('1.0', '2.0')
    AND cutoff_rule IN ('before_pay_date', 'after_previous_regular_payday')
    AND cutoff_days BETWEEN 0 AND 31
    AND (
      (schema_version = '1.0' AND cutoff_rule = 'before_pay_date' AND cutoff_days = 7
        AND previous_regular_pay_date IS NULL
        AND (((COALESCE(policy_cutoff_at, cutoff_at) AT TIME ZONE 'UTC') AT TIME ZONE 'Pacific/Guam')::date = pay_date - 7))
      OR
      (schema_version = '2.0' AND (
        (cutoff_rule = 'before_pay_date' AND previous_regular_pay_date IS NULL
          AND (((COALESCE(policy_cutoff_at, cutoff_at) AT TIME ZONE 'UTC') AT TIME ZONE 'Pacific/Guam')::date = pay_date - cutoff_days))
        OR
        (cutoff_rule = 'after_previous_regular_payday'
          AND previous_regular_pay_date IS NOT NULL
          AND previous_regular_pay_date < pay_date
          AND previous_regular_pay_date + cutoff_days < pay_date
          AND (((COALESCE(policy_cutoff_at, cutoff_at) AT TIME ZONE 'UTC') AT TIME ZONE 'Pacific/Guam')::date = previous_regular_pay_date + cutoff_days))
      ))
    )
  SQL

  LEGACY_DATE_CHECK = POLICY_DATE_CHECK.gsub("COALESCE(policy_cutoff_at, cutoff_at)", "cutoff_at")

  # An override must keep its policy evidence, apply only to scheduled locks,
  # and stay between the start of the day after the period and the end of the
  # day two days before payday (Guam).
  OVERRIDE_CHECK = <<~SQL.squish
    (cutoff_source = 'policy' AND policy_cutoff_at IS NULL AND cutoff_override IS NULL)
    OR
    (cutoff_source = 'override'
      AND policy_cutoff_at IS NOT NULL
      AND cutoff_override IS NOT NULL
      AND jsonb_typeof(cutoff_override) = 'object'
      AND length(btrim(coalesce(cutoff_override ->> 'reason', ''))) > 0
      AND lock_mode = 'scheduled'
      AND ((cutoff_at AT TIME ZONE 'UTC') AT TIME ZONE 'Pacific/Guam')::date > end_date
      AND ((cutoff_at AT TIME ZONE 'UTC') AT TIME ZONE 'Pacific/Guam')::date <= pay_date - 2)
  SQL

  GUARDED_COLUMNS = %w[
    external_pay_period_id start_date end_date pay_date cutoff_at time_zone cutoff_days_before schema_version
    cutoff_rule cutoff_days previous_regular_pay_date schedule_version publication_id request_checksum
  ].freeze

  def up
    add_column :payroll_calendar_periods, :cutoff_source, :string, null: false, default: "policy"
    add_column :payroll_calendar_periods, :policy_cutoff_at, :datetime
    add_column :payroll_calendar_periods, :cutoff_override, :jsonb

    remove_check_constraint :payroll_calendar_periods, name: "check_payroll_calendar_period_cutoff_date"
    add_check_constraint :payroll_calendar_periods, POLICY_DATE_CHECK, name: "check_payroll_calendar_period_cutoff_date"
    add_check_constraint :payroll_calendar_periods, OVERRIDE_CHECK, name: "check_payroll_calendar_period_cutoff_override"

    replace_guard(GUARDED_COLUMNS + %w[cutoff_source policy_cutoff_at cutoff_override])
  end

  def down
    if select_value("SELECT EXISTS (SELECT 1 FROM payroll_calendar_periods WHERE cutoff_source <> 'policy')")
      raise ActiveRecord::IrreversibleMigration,
            "Overridden payroll cutoffs exist; preserve them before rolling back this migration"
    end

    replace_guard(GUARDED_COLUMNS)
    remove_check_constraint :payroll_calendar_periods, name: "check_payroll_calendar_period_cutoff_override"
    remove_check_constraint :payroll_calendar_periods, name: "check_payroll_calendar_period_cutoff_date"
    add_check_constraint :payroll_calendar_periods, LEGACY_DATE_CHECK, name: "check_payroll_calendar_period_cutoff_date"
    remove_column :payroll_calendar_periods, :cutoff_override
    remove_column :payroll_calendar_periods, :policy_cutoff_at
    remove_column :payroll_calendar_periods, :cutoff_source
  end

  private

  def replace_guard(columns)
    changed = columns.map { |column| "NEW.#{column} IS DISTINCT FROM OLD.#{column}" }.join("\n       OR ")
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
             #{changed}
           ) THEN
          RAISE EXCEPTION 'payroll calendar schedules cannot change after cutoff';
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    SQL
  end
end
