class AddLockedAtToTimeEntries < ActiveRecord::Migration[8.1]
  def change
    add_column :time_entries, :locked_at, :datetime
  end
end
