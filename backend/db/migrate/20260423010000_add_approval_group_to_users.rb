# frozen_string_literal: true

class AddApprovalGroupToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :approval_group, :string
    add_index :users, :approval_group
  end
end
