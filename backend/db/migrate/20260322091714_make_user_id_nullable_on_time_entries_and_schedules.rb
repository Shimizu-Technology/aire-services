class MakeUserIdNullableOnTimeEntriesAndSchedules < ActiveRecord::Migration[8.1]
  def change
    change_column_null :time_entries, :user_id, true
    change_column_null :schedules, :user_id, true
  end
end
