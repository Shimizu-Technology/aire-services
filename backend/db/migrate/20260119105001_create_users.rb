class CreateUsers < ActiveRecord::Migration[8.1]
  def change
    create_table :users do |t|
      t.string :clerk_id, null: false
      t.string :email, null: false
      t.string :first_name
      t.string :last_name
      t.string :role, default: 'client'  # admin, employee, client
      t.string :phone
      t.references :client, foreign_key: true  # optional, only for client role

      t.timestamps
    end
    add_index :users, :clerk_id, unique: true
    add_index :users, :email
    add_index :users, :role
  end
end
