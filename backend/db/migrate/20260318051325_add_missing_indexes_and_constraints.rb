class AddMissingIndexesAndConstraints < ActiveRecord::Migration[8.1]
  def change
    unless index_exists?(:service_types, :name, unique: true)
      add_index :service_types, :name, unique: true, name: "index_service_types_on_name_unique"
    end

    unless index_exists?(:service_tasks, [:service_type_id, :name], unique: true)
      add_index :service_tasks, [:service_type_id, :name], unique: true, name: "index_service_tasks_on_type_and_name_unique"
    end

    unless connection.select_value("SELECT 1 FROM pg_constraint WHERE conname = 'check_valid_role'")
      execute <<~SQL
        ALTER TABLE users ADD CONSTRAINT check_valid_role
        CHECK (role IN ('admin', 'employee', 'client'))
      SQL
    end
  end
end
