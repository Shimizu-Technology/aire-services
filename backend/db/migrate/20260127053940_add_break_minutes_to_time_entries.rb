class AddBreakMinutesToTimeEntries < ActiveRecord::Migration[8.1]
  def change
    add_column :time_entries, :break_minutes, :integer
  end
end
