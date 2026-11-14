# frozen_string_literal: true

class AddAdminPersonEditing < ActiveRecord::Migration[8.1]
  def up
    # Fail fast instead of queueing every users query behind this ALTER while
    # the old code is still serving (migrations run in Render's build).
    execute "SET LOCAL lock_timeout = '5s'"
    # Explicit admin-only concurrency token; deliberately not Rails lock_version.
    add_column :users, :admin_edit_version, :integer, default: 0, null: false
    add_column :users, :public_team_bio, :text
    add_column :users, :termination_access_snapshot, :jsonb, default: {}, null: false
  end

  def down
    remove_column :users, :termination_access_snapshot
    remove_column :users, :public_team_bio
    remove_column :users, :admin_edit_version
  end
end
