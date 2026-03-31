class CreateServiceTypes < ActiveRecord::Migration[8.1]
  def change
    create_table :service_types do |t|
      t.string :name, null: false
      t.text :description
      t.string :color
      t.boolean :is_active, default: true, null: false
      t.integer :position, default: 0, null: false

      t.timestamps
    end

    add_index :service_types, :is_active
    add_index :service_types, :position
  end
end
