# frozen_string_literal: true

class SetVerifiedFranciscoMaintenanceRate < ActiveRecord::Migration[8.1]
  # Francisco San Nicolas is the employee known operationally as Kiko.
  OPERATIONAL_NAME = "Kiko"
  SOURCE_USER_ID = 39
  SOURCE_UUID = "b726ad82-8589-41d1-80ce-ce74de6f9621"
  CATEGORY_KEY = "aire_maintenance"
  RATE_CENTS = 1_600

  def up
    person = connection.select_one(<<~SQL)
      SELECT id, first_name, last_name, role, payroll_integration_uuid
      FROM users WHERE id = #{SOURCE_USER_ID}
    SQL
    raise "Francisco's AIRE identity is missing" if person.nil?
    unless person["first_name"] == "Francisco" && person["last_name"] == "San Nicolas" &&
           person["role"] == "employee" && person["payroll_integration_uuid"] == SOURCE_UUID
      raise "AIRE identity changed; do not apply the verified maintenance rate automatically"
    end

    category = connection.select_one(<<~SQL)
      SELECT id FROM time_categories WHERE key = #{connection.quote(CATEGORY_KEY)} AND is_active = true
    SQL
    raise "AIRE Aircraft Maintenance category is missing or inactive" unless category

    existing = connection.select_one(<<~SQL)
      SELECT hourly_rate_cents FROM employee_pay_rates
      WHERE user_id = #{SOURCE_USER_ID} AND time_category_id = #{category.fetch('id')}
    SQL
    if existing && existing.fetch("hourly_rate_cents").to_i != RATE_CENTS
      raise "Francisco already has a different maintenance rate; review before deploying"
    end

    conflicting_entries = connection.select_value(<<~SQL).to_i
      SELECT COUNT(*) FROM time_entries
      WHERE user_id = #{SOURCE_USER_ID} AND time_category_id = #{category.fetch('id')}
        AND effective_rate_cents_snapshot IS NOT NULL
        AND effective_rate_cents_snapshot <> #{RATE_CENTS}
    SQL
    raise "Francisco has time entered at another snapshotted rate; reconcile it first" if conflicting_entries.positive?

    execute <<~SQL
      INSERT INTO user_time_categories (user_id, time_category_id, created_at, updated_at)
      VALUES (#{SOURCE_USER_ID}, #{category.fetch('id')}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, time_category_id) DO NOTHING
    SQL

    unless existing
      execute <<~SQL
        INSERT INTO employee_pay_rates (user_id, time_category_id, hourly_rate_cents, created_at, updated_at)
        VALUES (#{SOURCE_USER_ID}, #{category.fetch('id')}, #{RATE_CENTS}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      SQL
    end

    execute <<~SQL
      UPDATE time_entries SET effective_rate_cents_snapshot = #{RATE_CENTS}, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = #{SOURCE_USER_ID} AND time_category_id = #{category.fetch('id')}
        AND status = 'completed'
        AND effective_rate_cents_snapshot IS NULL
    SQL

    execute <<~SQL
      INSERT INTO audit_logs (
        action, auditable_id, auditable_type, changes_made, metadata,
        created_at, updated_at, event_category, occurred_at, actor_kind,
        source, subject_name, outcome
      )
      SELECT
        'payroll.staff_rate.verified', #{SOURCE_USER_ID}, 'User',
        jsonb_build_object('hourly_rate_cents', jsonb_build_array(NULL, #{RATE_CENTS})),
        jsonb_build_object(
          'operational_name', #{connection.quote(OPERATIONAL_NAME)},
          'time_category_key', #{connection.quote(CATEGORY_KEY)}
        ),
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'payroll', CURRENT_TIMESTAMP,
        'system', 'integration',
        #{connection.quote("Francisco San Nicolas (#{OPERATIONAL_NAME})")}, 'succeeded'
      WHERE NOT EXISTS (
        SELECT 1 FROM audit_logs
        WHERE action = 'payroll.staff_rate.verified'
          AND auditable_type = 'User'
          AND auditable_id = #{SOURCE_USER_ID}
      )
    SQL
  end

  def down
    raise ActiveRecord::IrreversibleMigration, "A verified staff rate may already have been used for payroll"
  end
end
