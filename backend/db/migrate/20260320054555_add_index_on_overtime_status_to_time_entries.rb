# frozen_string_literal: true

class AddIndexOnOvertimeStatusToTimeEntries < ActiveRecord::Migration[8.1]
  def change
    add_index :time_entries, :overtime_status
  end
end
