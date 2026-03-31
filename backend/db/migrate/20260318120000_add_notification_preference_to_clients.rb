# frozen_string_literal: true

class AddNotificationPreferenceToClients < ActiveRecord::Migration[8.1]
  def change
    unless column_exists?(:clients, :notification_preference)
      add_column :clients, :notification_preference, :string, default: "email", null: false
    end
  end
end
