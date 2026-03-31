# frozen_string_literal: true

class AddUniqueIndexOnUsersClientId < ActiveRecord::Migration[8.1]
  def change
    remove_index :users, :client_id, if_exists: true
    add_index :users, :client_id, unique: true, where: "client_id IS NOT NULL", name: "index_users_on_client_id_unique"
  end
end
