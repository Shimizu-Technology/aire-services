# frozen_string_literal: true

class CreateUserTimeCategories < ActiveRecord::Migration[8.1]
  def change
    create_table :user_time_categories do |t|
      t.references :user, null: false, foreign_key: true
      t.references :time_category, null: false, foreign_key: true
      t.integer :hourly_rate_cents

      t.timestamps
    end

    add_index :user_time_categories, [ :user_id, :time_category_id ], unique: true
  end
end
