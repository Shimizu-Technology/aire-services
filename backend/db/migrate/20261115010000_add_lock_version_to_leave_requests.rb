# frozen_string_literal: true

class AddLockVersionToLeaveRequests < ActiveRecord::Migration[8.0]
  def change
    add_column :leave_requests, :lock_version, :integer, null: false, default: 0
  end
end
