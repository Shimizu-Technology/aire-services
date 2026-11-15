# frozen_string_literal: true

class TrackEmployeeClockOutCorrections < ActiveRecord::Migration[8.1]
  def up
    execute "SET LOCAL lock_timeout = '5s'"
    add_column :time_entries, :employee_corrected_clock_out, :boolean, null: false, default: false
  end

  def down
    execute "SET LOCAL lock_timeout = '5s'"
    remove_column :time_entries, :employee_corrected_clock_out
  end
end
