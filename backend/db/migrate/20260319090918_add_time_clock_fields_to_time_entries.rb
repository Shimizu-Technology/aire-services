# frozen_string_literal: true

class AddTimeClockFieldsToTimeEntries < ActiveRecord::Migration[8.1]
  def change
    add_reference :time_entries, :schedule, null: true, foreign_key: true
    add_column :time_entries, :clock_in_at, :datetime, null: true
    add_column :time_entries, :clock_out_at, :datetime, null: true
    add_column :time_entries, :entry_method, :string, default: "manual", null: false
    add_column :time_entries, :status, :string, default: "completed", null: false
    add_column :time_entries, :admin_override, :boolean, default: false, null: false
    add_column :time_entries, :attendance_status, :string, null: true
    add_column :time_entries, :approval_status, :string, null: true
    add_reference :time_entries, :approved_by, null: true, foreign_key: { to_table: :users }
    add_column :time_entries, :approved_at, :datetime, null: true
    add_column :time_entries, :approval_note, :text, null: true
    add_column :time_entries, :overtime_status, :string, null: true

    add_index :time_entries, :status
    add_index :time_entries, :approval_status
    add_index :time_entries, :entry_method
  end
end
