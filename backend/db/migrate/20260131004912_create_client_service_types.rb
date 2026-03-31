class CreateClientServiceTypes < ActiveRecord::Migration[8.1]
  def change
    create_table :client_service_types do |t|
      t.references :client, null: false, foreign_key: true
      t.references :service_type, null: false, foreign_key: true

      t.timestamps
    end

    # Prevent duplicate client-service associations
    add_index :client_service_types, [:client_id, :service_type_id], unique: true
  end
end
