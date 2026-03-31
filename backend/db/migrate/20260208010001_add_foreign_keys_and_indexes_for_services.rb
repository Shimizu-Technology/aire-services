# frozen_string_literal: true

class AddForeignKeysAndIndexesForServices < ActiveRecord::Migration[8.1]
  def change
    # Composite unique index on client_service_types
    # NOTE: index_client_service_types_on_client_id_and_service_type_id already exists from migration 20260131004912
    # We just need to ensure it's unique (it already is), so skip adding duplicate index

    # Add foreign key constraints for data integrity (skip if already exists)
    unless foreign_key_exists?(:service_tasks, :service_types)
      add_foreign_key :service_tasks, :service_types, on_delete: :cascade
    end
    unless foreign_key_exists?(:client_service_types, :clients)
      add_foreign_key :client_service_types, :clients, on_delete: :cascade
    end
    unless foreign_key_exists?(:client_service_types, :service_types)
      add_foreign_key :client_service_types, :service_types, on_delete: :cascade
    end
    
    # Foreign keys for time_entries (nullify on delete since these are optional)
    unless foreign_key_exists?(:time_entries, :service_types)
      add_foreign_key :time_entries, :service_types, on_delete: :nullify
    end
    unless foreign_key_exists?(:time_entries, :service_tasks)
      add_foreign_key :time_entries, :service_tasks, on_delete: :nullify
    end
  end
end
