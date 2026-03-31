class MakeCreatedByIdNullableOnDailyTasks < ActiveRecord::Migration[8.1]
  def change
    change_column_null :daily_tasks, :created_by_id, true
  end
end
