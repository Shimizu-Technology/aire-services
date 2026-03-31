# frozen_string_literal: true

class AddClockSourceToTimeEntries < ActiveRecord::Migration[8.0]
  def change
    add_column :time_entries, :clock_source, :string
    add_index :time_entries, :clock_source
  end
end
