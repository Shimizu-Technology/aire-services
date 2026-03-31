class AddTimesToTimeEntries < ActiveRecord::Migration[8.1]
  def up
    add_column :time_entries, :start_time, :time
    add_column :time_entries, :end_time, :time

    # Migrate existing entries with default times based on hours
    # Default start time is 8:00 AM, end time calculated from hours
    execute <<-SQL
      UPDATE time_entries
      SET start_time = '08:00:00'::time,
          end_time = ('08:00:00'::time + (hours * INTERVAL '1 hour'))::time
      WHERE start_time IS NULL
    SQL
  end

  def down
    remove_column :time_entries, :start_time
    remove_column :time_entries, :end_time
  end
end
