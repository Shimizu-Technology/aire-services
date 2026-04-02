# frozen_string_literal: true

class CreateEmployeePayRates < ActiveRecord::Migration[8.0]
  def change
    create_table :employee_pay_rates do |t|
      t.references :user, null: false, foreign_key: true
      t.references :time_category, null: false, foreign_key: true
      t.integer :hourly_rate_cents, null: false
      t.timestamps
    end

    add_index :employee_pay_rates, [ :user_id, :time_category_id ], unique: true, name: "idx_employee_pay_rates_user_category"
  end
end
