class AddPayDateToOperationCycles < ActiveRecord::Migration[8.1]
  def change
    add_column :operation_cycles, :pay_date, :date
    add_index :operation_cycles, :pay_date
  end
end
