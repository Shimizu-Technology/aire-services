# frozen_string_literal: true

class AddAdminPersonEditing < ActiveRecord::Migration[8.1]
  def change
    # Explicit admin-only concurrency token; deliberately not Rails lock_version.
    add_column :users, :admin_edit_version, :integer, default: 0, null: false
    add_column :users, :public_team_bio, :text
    add_column :users, :termination_access_snapshot, :jsonb, default: {}, null: false
  end
end
