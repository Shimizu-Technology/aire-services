# frozen_string_literal: true

class AddCancellationTrackingToLeaveRequests < ActiveRecord::Migration[8.1]
  def change
    add_reference :leave_requests, :cancelled_by, foreign_key: { to_table: :users }
    add_column :leave_requests, :cancelled_at, :datetime
  end
end
