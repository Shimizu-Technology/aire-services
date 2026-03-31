# frozen_string_literal: true

class AddOvertimeApprovalFieldsToTimeEntries < ActiveRecord::Migration[8.1]
  def change
    add_column :time_entries, :overtime_approved_by_id, :bigint
    add_column :time_entries, :overtime_approved_at, :datetime
    add_column :time_entries, :overtime_note, :text
    add_foreign_key :time_entries, :users, column: :overtime_approved_by_id
    add_index :time_entries, :overtime_approved_by_id
  end
end
