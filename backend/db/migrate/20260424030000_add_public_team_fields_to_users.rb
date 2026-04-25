# frozen_string_literal: true

class AddPublicTeamFieldsToUsers < ActiveRecord::Migration[8.0]
  def change
    add_column :users, :public_team_enabled, :boolean, null: false, default: false
    add_column :users, :public_team_name, :string
    add_column :users, :public_team_title, :string
    add_column :users, :public_team_sort_order, :integer, null: false, default: 0

    add_index :users, [ :public_team_enabled, :public_team_sort_order ], name: "index_users_on_public_team_visibility_and_sort"
  end
end
