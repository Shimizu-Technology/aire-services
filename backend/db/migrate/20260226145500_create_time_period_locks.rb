class CreateTimePeriodLocks < ActiveRecord::Migration[8.1]
  def change
    create_table :time_period_locks do |t|
      t.date :start_date, null: false
      t.date :end_date, null: false
      t.datetime :locked_at, null: false
      t.references :locked_by, null: false, foreign_key: { to_table: :users }
      t.text :reason

      t.timestamps
    end

    add_index :time_period_locks, [:start_date, :end_date], unique: true
  end
end
