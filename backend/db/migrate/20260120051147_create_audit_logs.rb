# frozen_string_literal: true

class CreateAuditLogs < ActiveRecord::Migration[8.0]
  def change
    create_table :audit_logs do |t|
      # What was changed (polymorphic)
      t.string :auditable_type, null: false
      t.bigint :auditable_id, null: false

      # What action was performed
      t.string :action, null: false  # created, updated, deleted

      # Who performed the action
      t.references :user, null: true, foreign_key: true

      # What changed (for updates)
      t.json :changes_made

      # Optional metadata
      t.string :metadata

      t.timestamps
    end

    add_index :audit_logs, [:auditable_type, :auditable_id]
    add_index :audit_logs, :action
    add_index :audit_logs, :created_at
  end
end
