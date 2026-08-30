# frozen_string_literal: true

require "rails_helper"
require Rails.root.join("db/migrate/20260830151000_add_audit_log_indexes")

RSpec.describe AddAuditLogIndexes do
  it "drops an invalid concurrent index before retrying it" do
    migration = described_class.new
    connection = instance_double(ActiveRecord::ConnectionAdapters::PostgreSQLAdapter)
    allow(migration).to receive(:connection).and_return(connection)
    allow(connection).to receive(:select_value).and_return(false)
    allow(connection).to receive(:quote).with("index_audit_logs_retry").and_return("'index_audit_logs_retry'")
    allow(connection).to receive(:quote_table_name).with("index_audit_logs_retry").and_return('"index_audit_logs_retry"')

    expect(connection).to receive(:execute).with('DROP INDEX CONCURRENTLY "index_audit_logs_retry"')

    migration.send(:drop_invalid_index, "index_audit_logs_retry")
  end
end
