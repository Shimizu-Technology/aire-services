# frozen_string_literal: true

class AddAuditLogIndexes < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  STANDARD_INDEXES = [
    { columns: [ :occurred_at, :id ], name: "index_audit_logs_on_occurred_at_and_id" },
    { columns: [ :event_category, :occurred_at ], name: "index_audit_logs_on_category_and_occurred_at" },
    { columns: [ :user_id, :occurred_at ], name: "index_audit_logs_on_actor_and_occurred_at" },
    { columns: :request_id, name: "index_audit_logs_on_request_id" },
    { columns: :correlation_id, name: "index_audit_logs_on_correlation_id" }
  ].freeze

  SEARCH_COLUMNS = %i[actor_name actor_email subject_name action auditable_type].freeze

  def up
    enable_extension "pg_trgm" unless extension_enabled?("pg_trgm")

    STANDARD_INDEXES.each do |index|
      next if index_name_exists?(:audit_logs, index[:name])

      add_index :audit_logs, index[:columns], name: index[:name], algorithm: :concurrently
    end
    unless index_name_exists?(:audit_logs, "index_audit_logs_on_action_and_session_fingerprint")
      add_index :audit_logs, [ :action, :session_fingerprint ], unique: true,
                where: "session_fingerprint IS NOT NULL",
                name: "index_audit_logs_on_action_and_session_fingerprint",
                algorithm: :concurrently
    end
    SEARCH_COLUMNS.each do |column|
      next if index_name_exists?(:audit_logs, "index_audit_logs_on_#{column}_trigram")

      add_index :audit_logs, column, using: :gin, opclass: :gin_trgm_ops,
                name: "index_audit_logs_on_#{column}_trigram", algorithm: :concurrently
    end
    unless index_name_exists?(:audit_logs, "index_audit_logs_on_normalized_type_trigram")
      execute <<~SQL
        CREATE INDEX CONCURRENTLY index_audit_logs_on_normalized_type_trigram
        ON audit_logs
        USING gin ((LOWER(REPLACE(REPLACE(auditable_type, '_', ''), ' ', ''))) gin_trgm_ops)
      SQL
    end
  end

  def down
    execute "DROP INDEX CONCURRENTLY IF EXISTS index_audit_logs_on_normalized_type_trigram"
    SEARCH_COLUMNS.reverse_each do |column|
      remove_index :audit_logs, name: "index_audit_logs_on_#{column}_trigram", algorithm: :concurrently
    end
    remove_index :audit_logs, name: "index_audit_logs_on_action_and_session_fingerprint", algorithm: :concurrently
    STANDARD_INDEXES.reverse_each do |index|
      remove_index :audit_logs, name: index[:name], algorithm: :concurrently
    end
  end
end
