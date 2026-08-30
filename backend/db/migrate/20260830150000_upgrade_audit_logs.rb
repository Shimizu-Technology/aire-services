# frozen_string_literal: true

class UpgradeAuditLogs < ActiveRecord::Migration[8.1]
  def up
    add_column :audit_logs, :event_category, :string
    add_column :audit_logs, :occurred_at, :datetime
    add_column :audit_logs, :actor_name, :string
    add_column :audit_logs, :actor_email, :string
    add_column :audit_logs, :actor_role, :string
    add_column :audit_logs, :actor_kind, :string
    add_column :audit_logs, :source, :string
    add_column :audit_logs, :subject_name, :string
    add_column :audit_logs, :outcome, :string
    add_column :audit_logs, :request_id, :string
    add_column :audit_logs, :ip_address, :string
    add_column :audit_logs, :user_agent, :string
    add_column :audit_logs, :correlation_id, :string
    add_column :audit_logs, :session_fingerprint, :string

    execute <<~SQL.squish
      ALTER TABLE audit_logs
      ALTER COLUMN metadata TYPE jsonb
      USING CASE
        WHEN metadata IS NULL OR btrim(metadata) = '' THEN '{}'::jsonb
        ELSE jsonb_build_object('message', metadata)
      END
    SQL
    execute "ALTER TABLE audit_logs ALTER COLUMN metadata SET DEFAULT '{}'::jsonb"
    execute "UPDATE audit_logs SET metadata = '{}'::jsonb WHERE metadata IS NULL"
    change_column_null :audit_logs, :metadata, false

    execute <<~SQL.squish
      ALTER TABLE audit_logs
      ALTER COLUMN changes_made TYPE jsonb
      USING changes_made::jsonb
    SQL

    execute <<~SQL.squish
      UPDATE audit_logs
      SET occurred_at = created_at,
          event_category = CASE
            WHEN auditable_type = 'TimeEntry' THEN 'time_tracking'
            WHEN auditable_type = 'LeaveRequest' THEN 'leave'
            WHEN auditable_type = 'TimePeriodLock' THEN 'time_tracking'
            WHEN auditable_type = 'User' THEN 'users'
            ELSE 'activity'
          END,
          actor_kind = CASE WHEN user_id IS NULL THEN 'system' ELSE 'user' END,
          source = 'legacy',
          outcome = 'succeeded'
    SQL
    execute <<~SQL.squish
      UPDATE audit_logs
      SET actor_name = concat_ws(' ', users.first_name, users.last_name),
          actor_email = users.email,
          actor_role = users.role
      FROM users
      WHERE audit_logs.user_id = users.id
    SQL

    change_column_null :audit_logs, :event_category, false
    change_column_null :audit_logs, :occurred_at, false
    change_column_null :audit_logs, :actor_kind, false
    change_column_null :audit_logs, :source, false
    change_column_null :audit_logs, :outcome, false
    change_column_default :audit_logs, :event_category, from: nil, to: "activity"
    change_column_default :audit_logs, :actor_kind, from: nil, to: "user"
    change_column_default :audit_logs, :source, from: nil, to: "web"
    change_column_default :audit_logs, :outcome, from: nil, to: "succeeded"

    execute <<~SQL
      CREATE OR REPLACE FUNCTION protect_audit_logs_from_mutation()
      RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'audit logs are append-only';
        END IF;

        IF NEW.user_id IS NULL
           AND OLD.user_id IS NOT NULL
           AND (to_jsonb(NEW) - 'user_id') = (to_jsonb(OLD) - 'user_id') THEN
          RETURN NEW;
        END IF;

        RAISE EXCEPTION 'audit logs are append-only';
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER audit_logs_append_only
      BEFORE UPDATE OR DELETE ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION protect_audit_logs_from_mutation();
    SQL
  end

  def down
    execute "DROP TRIGGER IF EXISTS audit_logs_append_only ON audit_logs"
    execute "DROP FUNCTION IF EXISTS protect_audit_logs_from_mutation()"

    execute <<~SQL.squish
      ALTER TABLE audit_logs
      ALTER COLUMN metadata DROP DEFAULT,
      ALTER COLUMN metadata TYPE varchar
      USING COALESCE(metadata->>'message', metadata::text)
    SQL
    change_column_null :audit_logs, :metadata, true
    execute <<~SQL.squish
      ALTER TABLE audit_logs
      ALTER COLUMN changes_made TYPE json
      USING changes_made::json
    SQL

    remove_columns :audit_logs,
                   :event_category,
                   :occurred_at,
                   :actor_name,
                   :actor_email,
                   :actor_role,
                   :actor_kind,
                   :source,
                   :subject_name,
                   :outcome,
                   :request_id,
                   :ip_address,
                   :user_agent,
                   :correlation_id,
                   :session_fingerprint
  end
end
