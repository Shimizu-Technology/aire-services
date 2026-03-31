# frozen_string_literal: true

class AddKioskFieldsToUsers < ActiveRecord::Migration[8.0]
  def change
    add_column :users, :kiosk_pin_digest, :string
    add_column :users, :kiosk_pin_lookup_hash, :string
    add_column :users, :kiosk_pin_last_rotated_at, :datetime
    add_column :users, :kiosk_enabled, :boolean, default: false, null: false
    add_column :users, :kiosk_failed_attempts_count, :integer, default: 0, null: false
    add_column :users, :kiosk_locked_until, :datetime

    add_index :users, :kiosk_pin_lookup_hash, unique: true
    add_index :users, :kiosk_enabled
    add_index :users, :kiosk_locked_until
  end
end
