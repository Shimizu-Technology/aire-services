# frozen_string_literal: true

class CreateTimeEntryBreaks < ActiveRecord::Migration[8.1]
  def change
    create_table :time_entry_breaks do |t|
      t.references :time_entry, null: false, foreign_key: true
      t.datetime :start_time, null: false
      t.datetime :end_time, null: true
      t.integer :duration_minutes, null: true

      t.timestamps
    end
  end
end
