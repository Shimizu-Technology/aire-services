# frozen_string_literal: true

class AddUniqueActiveClockInIndex < ActiveRecord::Migration[8.1]
  def change
    add_index :time_entries, :user_id,
              unique: true,
              where: "status IN ('clocked_in', 'on_break')",
              name: "index_time_entries_one_active_per_user"
  end
end
