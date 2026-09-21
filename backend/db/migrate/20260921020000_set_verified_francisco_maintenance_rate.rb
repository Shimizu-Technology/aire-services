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
    if person.nil?
      raise "Francisco's AIRE identity is missing" if Rails.env.production?

      return
    end
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

    unless existing
      execute <<~SQL
        INSERT INTO employee_pay_rates (user_id, time_category_id, hourly_rate_cents, created_at, updated_at)
        VALUES (#{SOURCE_USER_ID}, #{category.fetch('id')}, #{RATE_CENTS}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      SQL
    end

    conflicting_entries = connection.select_value(<<~SQL).to_i
      SELECT COUNT(*) FROM time_entries
      WHERE user_id = #{SOURCE_USER_ID} AND time_category_id = #{category.fetch('id')}
        AND effective_rate_cents_snapshot IS NOT NULL
        AND effective_rate_cents_snapshot <> #{RATE_CENTS}
    SQL
    raise "Francisco has time entered at another snapshotted rate; reconcile it first" if conflicting_entries.positive?

    execute <<~SQL
      UPDATE time_entries SET effective_rate_cents_snapshot = #{RATE_CENTS}, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = #{SOURCE_USER_ID} AND time_category_id = #{category.fetch('id')}
        AND effective_rate_cents_snapshot IS NULL
    SQL
  end

  def down
    raise ActiveRecord::IrreversibleMigration, "A verified staff rate may already have been used for payroll"
  end
end
