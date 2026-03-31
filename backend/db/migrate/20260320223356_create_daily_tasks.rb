# frozen_string_literal: true

class CreateDailyTasks < ActiveRecord::Migration[8.1]
  def change
    create_table :daily_tasks do |t|
      t.string :title, null: false
      t.date :task_date, null: false
      t.integer :position, null: false, default: 0
      t.string :status, null: false, default: "not_started"
      t.string :priority, null: false, default: "normal"
      t.string :form_service
      t.text :comments
      t.date :due_date

      t.references :client, foreign_key: true
      t.references :tax_return, foreign_key: true
      t.references :service_type, foreign_key: true
      t.bigint :assigned_to_id
      t.bigint :reviewed_by_id
      t.bigint :created_by_id, null: false
      t.bigint :status_changed_by_id
      t.bigint :completed_by_id

      t.datetime :status_changed_at
      t.datetime :completed_at

      t.timestamps
    end

    add_foreign_key :daily_tasks, :users, column: :assigned_to_id
    add_foreign_key :daily_tasks, :users, column: :reviewed_by_id
    add_foreign_key :daily_tasks, :users, column: :created_by_id
    add_foreign_key :daily_tasks, :users, column: :status_changed_by_id
    add_foreign_key :daily_tasks, :users, column: :completed_by_id

    add_index :daily_tasks, [:task_date, :position]
    add_index :daily_tasks, [:task_date, :status]
    add_index :daily_tasks, :assigned_to_id
    add_index :daily_tasks, :status
    add_index :daily_tasks, [:due_date], where: "status != 'done'", name: "index_daily_tasks_pending_by_due_date"
  end
end
