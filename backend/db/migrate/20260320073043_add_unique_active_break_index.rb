# frozen_string_literal: true

class AddUniqueActiveBreakIndex < ActiveRecord::Migration[8.1]
  def change
    add_index :time_entry_breaks, :time_entry_id,
              unique: true,
              where: "end_time IS NULL",
              name: "index_time_entry_breaks_one_active_per_entry"
  end
end
