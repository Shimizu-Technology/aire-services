# frozen_string_literal: true

class DropDonorAppTables < ActiveRecord::Migration[8.0]
  def up
    # Remove FK columns from time_entries that reference donor-app tables
    remove_column :time_entries, :client_id, if_exists: true
    remove_column :time_entries, :tax_return_id, if_exists: true
    remove_column :time_entries, :service_type_id, if_exists: true
    remove_column :time_entries, :service_task_id, if_exists: true

    # Remove client_id from users (tax client portal link)
    remove_column :users, :client_id, if_exists: true

    # Drop donor-app tables in dependency order
    drop_table :transmittals, if_exists: true
    drop_table :operation_tasks, if_exists: true
    drop_table :operation_cycles, if_exists: true
    drop_table :client_operation_assignments, if_exists: true
    drop_table :operation_template_tasks, if_exists: true
    drop_table :operation_templates, if_exists: true
    drop_table :daily_tasks, if_exists: true
    drop_table :payroll_import_batches, if_exists: true
    drop_table :workflow_events, if_exists: true
    drop_table :notifications, if_exists: true
    drop_table :documents, if_exists: true
    drop_table :income_sources, if_exists: true
    drop_table :tax_returns, if_exists: true
    drop_table :dependents, if_exists: true
    drop_table :client_notes, if_exists: true
    drop_table :client_contacts, if_exists: true
    drop_table :client_service_types, if_exists: true
    drop_table :service_tasks, if_exists: true
    drop_table :service_types, if_exists: true
    drop_table :workflow_stages, if_exists: true
    drop_table :clients, if_exists: true
  end

  def down
    raise ActiveRecord::IrreversibleMigration
  end
end
