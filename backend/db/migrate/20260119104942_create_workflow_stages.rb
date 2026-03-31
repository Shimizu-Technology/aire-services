class CreateWorkflowStages < ActiveRecord::Migration[8.1]
  def change
    create_table :workflow_stages do |t|
      t.string :name, null: false
      t.string :slug, null: false
      t.text :description
      t.integer :position, null: false
      t.string :color
      t.boolean :notify_client, default: false
      t.boolean :is_active, default: true

      t.timestamps
    end
    add_index :workflow_stages, :slug, unique: true
    add_index :workflow_stages, :position
  end
end
