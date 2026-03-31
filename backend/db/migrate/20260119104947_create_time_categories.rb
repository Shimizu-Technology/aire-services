class CreateTimeCategories < ActiveRecord::Migration[8.1]
  def change
    create_table :time_categories do |t|
      t.string :name, null: false
      t.text :description
      t.boolean :is_active, default: true

      t.timestamps
    end
  end
end
