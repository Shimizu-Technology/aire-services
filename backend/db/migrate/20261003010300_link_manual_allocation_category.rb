# frozen_string_literal: true

class LinkManualAllocationCategory < ActiveRecord::Migration[8.1]
  def change
    add_index :payroll_manual_allocations, :time_category_id
    add_foreign_key :payroll_manual_allocations, :time_categories, column: :time_category_id,
                    name: "fk_manual_allocations_time_category"
  end
end
