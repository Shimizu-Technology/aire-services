class CreateSchedules < ActiveRecord::Migration[8.1]
  def change
    create_table :schedules do |t|
      t.references :user, null: false, foreign_key: true
      t.date :work_date, null: false
      t.time :start_time, null: false
      t.time :end_time, null: false
      t.text :notes
      t.references :created_by, foreign_key: { to_table: :users }

      t.timestamps
    end

    # Index for quick lookups by date range
    add_index :schedules, :work_date
    # Composite index for user + date queries
    add_index :schedules, [:user_id, :work_date]
  end
end
