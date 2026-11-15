# frozen_string_literal: true

class AddEmployeeChangeAndKioskSessions < ActiveRecord::Migration[8.1]
  def up
    execute "SET LOCAL lock_timeout = '5s'"
    add_column :time_entries, :original_employee_change, :jsonb
    add_column :time_entries, :rejected_employee_change, :jsonb
    create_table :kiosk_device_sessions do |t|
      t.references :user, null: false, foreign_key: true
      t.datetime :expires_at, null: false
      t.datetime :revoked_at
      t.timestamps
    end
  end

  def down
    execute "SET LOCAL lock_timeout = '5s'"
    drop_table :kiosk_device_sessions
    remove_column :time_entries, :rejected_employee_change
    remove_column :time_entries, :original_employee_change
  end
end
