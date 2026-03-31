# frozen_string_literal: true

class AddKeyAndHourlyRateToTimeCategories < ActiveRecord::Migration[8.0]
  def change
    add_column :time_categories, :key, :string
    add_column :time_categories, :hourly_rate_cents, :integer

    add_index :time_categories, :key, unique: true
  end
end
