class CreateWorkflowEvents < ActiveRecord::Migration[8.1]
  def change
    create_table :workflow_events do |t|
      t.references :tax_return, null: false, foreign_key: true
      t.references :user, foreign_key: true  # null for system-generated events
      t.string :event_type
      t.string :old_value
      t.string :new_value
      t.text :description

      t.timestamps
    end
  end
end
