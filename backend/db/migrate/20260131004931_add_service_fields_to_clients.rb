class AddServiceFieldsToClients < ActiveRecord::Migration[8.1]
  def change
    add_column :clients, :client_type, :string, default: 'individual'
    add_column :clients, :business_name, :string
    add_column :clients, :is_service_only, :boolean, default: false, null: false

    add_index :clients, :client_type
    add_index :clients, :is_service_only
  end
end
