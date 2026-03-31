# frozen_string_literal: true

class RemoveDuplicateClientServiceTypesIndex < ActiveRecord::Migration[8.1]
  def change
    # Remove duplicate index added by mistake
    # index_client_service_types_on_client_id_and_service_type_id already exists and is unique
    if index_exists?(:client_service_types, [:client_id, :service_type_id], name: 'index_client_service_types_unique')
      remove_index :client_service_types, name: 'index_client_service_types_unique'
    end
  end
end
