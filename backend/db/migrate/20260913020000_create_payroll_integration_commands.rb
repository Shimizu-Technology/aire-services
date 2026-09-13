# frozen_string_literal: true

class CreatePayrollIntegrationCommands < ActiveRecord::Migration[8.0]
  def change
    add_column :time_entries, :lock_version, :integer, null: false, default: 0

    create_table :payroll_integration_grants do |t|
      t.references :user, null: false, foreign_key: { on_delete: :cascade }
      t.string :token_digest, null: false
      t.string :token_hint, null: false
      t.string :capabilities, array: true, null: false, default: []
      t.boolean :active, null: false, default: true
      t.datetime :expires_at
      t.timestamps
    end

    add_index :payroll_integration_grants, :token_digest, unique: true
    add_check_constraint :payroll_integration_grants,
                         "capabilities <@ ARRAY['time_approval', 'payroll_finalization']::varchar[]",
                         name: "check_payroll_integration_grant_capabilities"

    create_table :payroll_integration_commands do |t|
      t.uuid :command_id, null: false
      t.string :action, null: false
      t.bigint :actor_id, null: false
      t.uuid :actor_payroll_integration_uuid, null: false
      t.string :target_type, null: false
      t.bigint :target_id, null: false
      t.integer :expected_version, null: false
      t.string :request_checksum, null: false
      t.integer :response_status, null: false
      t.jsonb :result_metadata, null: false, default: {}
      t.timestamps
    end

    add_index :payroll_integration_commands, :command_id, unique: true
    add_index :payroll_integration_commands, :actor_id
    add_index :payroll_integration_commands, [ :target_type, :target_id ], name: "idx_payroll_commands_target"
    add_check_constraint :payroll_integration_commands,
                         "expected_version >= 0",
                         name: "check_payroll_commands_expected_version"
    add_check_constraint :payroll_integration_commands,
                         "response_status BETWEEN 200 AND 299",
                         name: "check_payroll_commands_response_status"
    add_check_constraint :payroll_integration_commands,
                         "jsonb_typeof(result_metadata) = 'object'",
                         name: "check_payroll_commands_result_metadata_object"

    reversible do |direction|
      direction.up do
        execute <<~SQL
          CREATE OR REPLACE FUNCTION protect_payroll_integration_command()
          RETURNS trigger AS $$
          BEGIN
            RAISE EXCEPTION 'payroll integration commands are append-only';
          END;
          $$ LANGUAGE plpgsql;

          CREATE TRIGGER payroll_integration_commands_append_only
          BEFORE UPDATE OR DELETE ON payroll_integration_commands
          FOR EACH ROW EXECUTE FUNCTION protect_payroll_integration_command();

          CREATE TRIGGER payroll_integration_commands_prevent_truncate
          BEFORE TRUNCATE ON payroll_integration_commands
          FOR EACH STATEMENT EXECUTE FUNCTION protect_payroll_integration_command();
        SQL
      end

      direction.down do
        execute <<~SQL
          DROP TRIGGER IF EXISTS payroll_integration_commands_append_only ON payroll_integration_commands;
          DROP TRIGGER IF EXISTS payroll_integration_commands_prevent_truncate ON payroll_integration_commands;
          DROP FUNCTION IF EXISTS protect_payroll_integration_command();
        SQL
      end
    end
  end
end
