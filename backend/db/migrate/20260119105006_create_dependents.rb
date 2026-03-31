class CreateDependents < ActiveRecord::Migration[8.1]
  def change
    create_table :dependents do |t|
      t.references :client, null: false, foreign_key: true
      t.string :name
      t.date :date_of_birth
      t.string :relationship
      t.integer :months_lived_with_client
      t.boolean :is_student
      t.boolean :is_disabled
      t.boolean :can_be_claimed_by_other

      t.timestamps
    end
  end
end
