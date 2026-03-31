class CreateOperationsTables < ActiveRecord::Migration[8.1]
  def change
    unless table_exists?(:operation_templates)
      create_table :operation_templates do |t|
        t.string :name, null: false
        t.text :description
        t.string :category, null: false, default: "general"
        t.string :recurrence_type, null: false, default: "monthly"
        t.integer :recurrence_interval
        t.date :recurrence_anchor
        t.boolean :auto_generate, null: false, default: true
        t.boolean :is_active, null: false, default: true
        t.references :created_by, foreign_key: { to_table: :users }
        t.timestamps
      end

      add_index :operation_templates, :name, unique: true
      add_index :operation_templates, :is_active
      add_index :operation_templates, :recurrence_type
    end

    unless table_exists?(:operation_template_tasks)
      create_table :operation_template_tasks do |t|
        t.references :operation_template, null: false, foreign_key: true
        t.string :title, null: false
        t.text :description
        t.integer :position, null: false, default: 0
        t.boolean :evidence_required, null: false, default: false
        t.boolean :is_active, null: false, default: true
        t.string :due_offset_from
        t.string :due_offset_unit
        t.integer :due_offset_value
        t.integer :dependency_template_task_ids, array: true, null: false, default: []
        t.references :default_assignee, foreign_key: { to_table: :users }
        t.timestamps
      end

      add_index :operation_template_tasks, [:operation_template_id, :position], name: "index_operation_template_tasks_order"
      add_index :operation_template_tasks, [:operation_template_id, :title], name: "index_operation_template_tasks_unique_title", unique: true
      add_index :operation_template_tasks, :is_active
    end

    unless table_exists?(:client_operation_assignments)
      create_table :client_operation_assignments do |t|
        t.references :client, null: false, foreign_key: true
        t.references :operation_template, null: false, foreign_key: true
        t.string :assignment_status, null: false, default: "active"
        t.string :cadence_type, null: false, default: "monthly"
        t.integer :cadence_interval
        t.date :cadence_anchor
        t.boolean :auto_generate, null: false, default: true
        t.date :starts_on
        t.date :ends_on
        t.references :created_by, foreign_key: { to_table: :users }
        t.timestamps
      end

      add_index :client_operation_assignments, [:client_id, :operation_template_id], name: "index_client_operation_assignments_unique", unique: true
      add_index :client_operation_assignments, :assignment_status
      add_index :client_operation_assignments, [:assignment_status, :auto_generate, :starts_on, :ends_on], name: "index_client_operation_assignments_auto_window"
    end

    unless table_exists?(:operation_cycles)
      create_table :operation_cycles do |t|
        t.references :client, null: false, foreign_key: true
        t.references :operation_template, null: false, foreign_key: true
        t.references :client_operation_assignment, foreign_key: true
        t.string :cycle_label, null: false
        t.date :period_start, null: false
        t.date :period_end, null: false
        t.string :status, null: false, default: "active"
        t.string :generation_mode, null: false, default: "manual"
        t.datetime :generated_at
        t.references :generated_by, foreign_key: { to_table: :users }
        t.timestamps
      end

      add_index :operation_cycles, [:client_id, :operation_template_id, :period_start, :period_end], name: "index_operation_cycles_unique_period", unique: true
      add_index :operation_cycles, [:client_id, :status]
      add_index :operation_cycles, [:client_id, :period_start, :created_at], name: "index_operation_cycles_client_recent", order: { period_start: :desc, created_at: :desc }
      add_index :operation_cycles, :status
    end

    unless table_exists?(:operation_tasks)
      create_table :operation_tasks do |t|
        t.references :operation_cycle, null: false, foreign_key: true
        t.references :operation_template_task, null: false, foreign_key: true
        t.references :client, null: false, foreign_key: true
        t.string :title, null: false
        t.text :description
        t.text :notes
        t.integer :position, null: false, default: 0
        t.string :status, null: false, default: "not_started"
        t.boolean :evidence_required, null: false, default: false
        t.text :evidence_note
        t.datetime :due_at
        t.datetime :started_at
        t.datetime :completed_at
        t.references :assigned_to, foreign_key: { to_table: :users }
        t.references :completed_by, foreign_key: { to_table: :users }
        t.references :linked_time_entry, foreign_key: { to_table: :time_entries }
        t.timestamps
      end

      add_index :operation_tasks, [:operation_cycle_id, :position], name: "index_operation_tasks_order"
      add_index :operation_tasks, [:client_id, :status]
      add_index :operation_tasks, [:assigned_to_id, :status]
      add_index :operation_tasks, :status
      add_index :operation_tasks, :due_at
      add_index :operation_tasks, [:status, :due_at], name: "index_operation_tasks_active_status_due", where: "status <> 'done'"
      add_index :operation_tasks, :linked_time_entry_id, name: "index_operation_tasks_on_linked_time_entry_unique", unique: true, where: "linked_time_entry_id IS NOT NULL"
    end
  end
end
