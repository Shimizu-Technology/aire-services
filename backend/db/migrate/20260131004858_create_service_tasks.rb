class CreateServiceTasks < ActiveRecord::Migration[8.1]
  def change
    create_table :service_tasks do |t|
      t.references :service_type, null: false, foreign_key: true
      t.string :name, null: false
      t.text :description
      t.boolean :is_active, default: true, null: false
      t.integer :position, default: 0, null: false

      t.timestamps
    end

    add_index :service_tasks, :is_active
    add_index :service_tasks, [:service_type_id, :position]
  end
end
