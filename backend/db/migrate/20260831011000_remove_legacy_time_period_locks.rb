# frozen_string_literal: true

class RemoveLegacyTimePeriodLocks < ActiveRecord::Migration[8.1]
  def up
    drop_table :time_period_locks
    remove_column :time_entries, :locked_at, :datetime
  end

  def down
    add_column :time_entries, :locked_at, :datetime
    add_index :time_entries, :locked_at

    create_table :time_period_locks do |t|
      t.date :start_date, null: false
      t.date :end_date, null: false
      t.datetime :locked_at, null: false
      t.references :locked_by, foreign_key: { to_table: :users, on_delete: :nullify }
      t.timestamps
    end
    add_index :time_period_locks, [ :start_date, :end_date ], unique: true
  end
end
