# frozen_string_literal: true

class CreateUserApprovalGroups < ActiveRecord::Migration[8.1]
  def up
    create_table :user_approval_groups do |t|
      t.references :user, null: false, foreign_key: true
      t.string :approval_group, null: false
      t.timestamps
    end

    add_index :user_approval_groups, [ :user_id, :approval_group ], unique: true
    add_index :user_approval_groups, :approval_group

    execute <<~SQL.squish
      INSERT INTO user_approval_groups (user_id, approval_group, created_at, updated_at)
      SELECT id, approval_group, NOW(), NOW()
      FROM users
      WHERE approval_group IS NOT NULL AND approval_group <> ''
    SQL
  end

  def down
    drop_table :user_approval_groups
  end
end
