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
      drop_invalid_index(index[:name])
      next if index_name_exists?(:audit_logs, index[:name])

      add_index :audit_logs, index[:columns], name: index[:name], algorithm: :concurrently
    end
    session_index_name = "index_audit_logs_on_action_and_session_fingerprint"
    drop_invalid_index(session_index_name)
    unless index_name_exists?(:audit_logs, session_index_name)
      add_index :audit_logs, [ :action, :session_fingerprint ], unique: true,
                where: "session_fingerprint IS NOT NULL",
                name: session_index_name,
                algorithm: :concurrently
    end
    SEARCH_COLUMNS.each do |column|
      index_name = "index_audit_logs_on_#{column}_trigram"
      drop_invalid_index(index_name)
      next if index_name_exists?(:audit_logs, index_name)

      add_index :audit_logs, column, using: :gin, opclass: :gin_trgm_ops,
                name: index_name, algorithm: :concurrently
    end
    normalized_index_name = "index_audit_logs_on_normalized_type_trigram"
    drop_invalid_index(normalized_index_name)
    unless index_name_exists?(:audit_logs, normalized_index_name)
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
      remove_index :audit_logs, name: "index_audit_logs_on_#{column}_trigram", algorithm: :concurrently, if_exists: true
    end
    remove_index :audit_logs, name: "index_audit_logs_on_action_and_session_fingerprint", algorithm: :concurrently, if_exists: true
    STANDARD_INDEXES.reverse_each do |index|
      remove_index :audit_logs, name: index[:name], algorithm: :concurrently, if_exists: true
    end
  end

  private

  def drop_invalid_index(index_name)
    valid = connection.select_value(<<~SQL.squish)
      SELECT pg_index.indisvalid
      FROM pg_index
      INNER JOIN pg_class ON pg_class.oid = pg_index.indexrelid
      INNER JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
      WHERE pg_class.relname = #{connection.quote(index_name)}
        AND pg_namespace.nspname = ANY (current_schemas(false))
    SQL
    return unless valid == false

    execute "DROP INDEX CONCURRENTLY #{connection.quote_table_name(index_name)}"
  end
end
