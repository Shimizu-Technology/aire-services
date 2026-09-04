# frozen_string_literal: true

class AddPayrollIntegrationIdentity < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :payroll_integration_uuid, :uuid, null: false, default: -> { "gen_random_uuid()" }
    add_index :users, :payroll_integration_uuid, unique: true

    add_column :payroll_batch_entries, :source_user_uuid, :uuid
    add_index :payroll_batch_entries, :source_user_uuid

    add_column :payroll_batch_exclusions, :source_user_uuid, :uuid
    add_index :payroll_batch_exclusions, :source_user_uuid
  end
end
