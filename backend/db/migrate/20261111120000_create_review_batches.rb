# frozen_string_literal: true

# A batch approval from the Approvals inbox and the exact rows it changed, so a
# double-tapped request replays instead of approving twice and an undo within
# 15 minutes can prove nothing changed since. Only new tables: no rewrite of,
# and no foreign key onto, time_entries or users.
class CreateReviewBatches < ActiveRecord::Migration[8.1]
  def change
    create_table :review_batches do |t|
      t.string :public_id, null: false
      t.bigint :actor_id, null: false
      t.string :idempotency_key, null: false
      # SHA-256 of the normalized items, so a reused key with a different
      # request is refused rather than replayed.
      t.string :request_fingerprint, null: false
      t.integer :entry_count, null: false
      t.integer :overtime_count, null: false, default: 0
      t.decimal :hours, precision: 10, scale: 2, null: false, default: 0
      t.datetime :undone_at
      t.bigint :undone_by_id
      t.timestamps
    end
    add_index :review_batches, :public_id, unique: true
    add_index :review_batches, [ :actor_id, :idempotency_key ], unique: true
    add_index :review_batches, :created_at

    create_table :review_batch_items do |t|
      t.references :review_batch, null: false, foreign_key: true, index: false
      # Not a foreign key: deleting a time entry must not be blocked by an old
      # approval record (audit rows work the same way).
      t.bigint :time_entry_id, null: false
      t.integer :version_before, null: false
      t.integer :version_after, null: false
      t.boolean :approved_time, null: false, default: false
      t.boolean :approved_overtime, null: false, default: false
      t.decimal :hours, precision: 10, scale: 2, null: false, default: 0
      t.decimal :overtime_hours, precision: 10, scale: 2, null: false, default: 0
      # Review fields as they were before and right after the approval.
      t.jsonb :before_state, null: false, default: {}
      t.jsonb :after_state, null: false, default: {}
      t.datetime :undone_at
      t.bigint :undone_by_id
      t.timestamps
    end
    add_index :review_batch_items, [ :review_batch_id, :time_entry_id ], unique: true
    add_index :review_batch_items, [ :time_entry_id, :created_at ]
  end
end
