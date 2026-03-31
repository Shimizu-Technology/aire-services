class CreateTimeEntries < ActiveRecord::Migration[8.1]
  def change
    create_table :time_entries do |t|
      t.references :user, null: false, foreign_key: true
      t.references :client, foreign_key: true  # optional
      t.references :tax_return, foreign_key: true  # optional
      t.references :time_category, foreign_key: true  # optional
      t.date :work_date, null: false
      t.decimal :hours, precision: 4, scale: 2, null: false
      t.text :description

      t.timestamps
    end

    add_index :time_entries, :work_date
  end
end
