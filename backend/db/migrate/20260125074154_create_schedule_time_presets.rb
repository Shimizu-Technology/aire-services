class CreateScheduleTimePresets < ActiveRecord::Migration[8.1]
  def change
    create_table :schedule_time_presets do |t|
      t.string :label, null: false
      t.time :start_time, null: false
      t.time :end_time, null: false
      t.integer :position, null: false, default: 0
      t.boolean :active, null: false, default: true

      t.timestamps
    end

    add_index :schedule_time_presets, :position
    add_index :schedule_time_presets, :active
  end
end
