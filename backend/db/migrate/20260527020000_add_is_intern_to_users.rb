# frozen_string_literal: true

class AddIsInternToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :is_intern, :boolean, null: false, default: false
    add_index :users, :is_intern
  end
end
