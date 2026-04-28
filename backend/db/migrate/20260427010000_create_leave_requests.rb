# frozen_string_literal: true

class CreateLeaveRequests < ActiveRecord::Migration[8.1]
  def change
    create_table :leave_requests do |t|
      t.references :user, null: false, foreign_key: true
      t.references :reviewed_by, foreign_key: { to_table: :users }
      t.string :leave_type, null: false
      t.date :start_date, null: false
      t.date :end_date, null: false
      t.string :status, null: false, default: "pending"
      t.text :reason
      t.text :review_note
      t.datetime :reviewed_at

      t.timestamps
    end

    add_index :leave_requests, :status
    add_index :leave_requests, [ :user_id, :start_date ]
    add_index :leave_requests, [ :status, :start_date ]
  end
end
