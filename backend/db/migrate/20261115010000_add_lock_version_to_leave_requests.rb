# frozen_string_literal: true

class AddLockVersionToLeaveRequests < ActiveRecord::Migration[8.0]
  def up
    execute "SET LOCAL lock_timeout = '5s'"
    add_column :leave_requests, :lock_version, :integer, null: false, default: 0
  end

  def down
    execute "SET LOCAL lock_timeout = '5s'"
    remove_column :leave_requests, :lock_version
  end
end
