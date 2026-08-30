# frozen_string_literal: true

class RemoveLegacyTimePeriodLocks < ActiveRecord::Migration[8.1]
  def up
    archive_time_period_locks
    archive_locked_time_entries
    drop_table :time_period_locks
    remove_column :time_entries, :locked_at, :datetime
  end

  def down
    add_column :time_entries, :locked_at, :datetime

    create_table :time_period_locks do |t|
      t.date :start_date, null: false
      t.date :end_date, null: false
      t.datetime :locked_at, null: false
      t.references :locked_by, null: false, foreign_key: { to_table: :users }
      t.text :reason

      t.timestamps
    end
    add_index :time_period_locks, [ :start_date, :end_date ], unique: true

    restore_time_period_locks
    restore_locked_time_entries
  end

  private

  def archive_time_period_locks
    execute <<~SQL
      INSERT INTO audit_logs (
        action, auditable_id, auditable_type, changes_made, created_at, metadata,
        updated_at, user_id, event_category, occurred_at, actor_name, actor_email,
        actor_role, actor_kind, source, subject_name, outcome
      )
      SELECT
        'legacy_time_period_lock.archived',
        legacy_lock.id,
        'TimePeriodLock',
        NULL,
        CURRENT_TIMESTAMP,
        jsonb_build_object(
          'archived_by_migration', '20260831011000',
          'start_date', legacy_lock.start_date,
          'end_date', legacy_lock.end_date,
          'locked_at', legacy_lock.locked_at,
          'locked_by_id', legacy_lock.locked_by_id,
          'reason', legacy_lock.reason,
          'original_created_at', legacy_lock.created_at,
          'original_updated_at', legacy_lock.updated_at
        ),
        CURRENT_TIMESTAMP,
        legacy_lock.locked_by_id,
        'scheduling',
        COALESCE(legacy_lock.locked_at, legacy_lock.created_at, CURRENT_TIMESTAMP),
        NULLIF(BTRIM(CONCAT_WS(' ', users.first_name, users.last_name)), ''),
        users.email,
        users.role,
        CASE WHEN users.id IS NULL THEN 'system' ELSE 'user' END,
        'legacy',
        CONCAT('Legacy payroll edit lock ', legacy_lock.start_date, '–', legacy_lock.end_date),
        'succeeded'
      FROM time_period_locks legacy_lock
      LEFT JOIN users ON users.id = legacy_lock.locked_by_id
      WHERE NOT EXISTS (
        SELECT 1
        FROM audit_logs existing
        WHERE existing.action = 'legacy_time_period_lock.archived'
          AND existing.auditable_type = 'TimePeriodLock'
          AND existing.auditable_id = legacy_lock.id
          AND existing.metadata->>'archived_by_migration' = '20260831011000'
      )
    SQL
  end

  def archive_locked_time_entries
    execute <<~SQL
      INSERT INTO audit_logs (
        action, auditable_id, auditable_type, changes_made, created_at, metadata,
        updated_at, user_id, event_category, occurred_at, actor_kind, source,
        subject_name, outcome
      )
      SELECT
        'time_entry.legacy_lock_archived',
        time_entries.id,
        'TimeEntry',
        NULL,
        CURRENT_TIMESTAMP,
        jsonb_build_object(
          'archived_by_migration', '20260831011000',
          'locked_at', time_entries.locked_at
        ),
        CURRENT_TIMESTAMP,
        NULL,
        'time_tracking',
        time_entries.locked_at,
        'system',
        'legacy',
        CONCAT('Time entry #', time_entries.id),
        'succeeded'
      FROM time_entries
      WHERE time_entries.locked_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM audit_logs existing
          WHERE existing.action = 'time_entry.legacy_lock_archived'
            AND existing.auditable_type = 'TimeEntry'
            AND existing.auditable_id = time_entries.id
            AND existing.metadata->>'archived_by_migration' = '20260831011000'
        )
    SQL
  end

  def restore_time_period_locks
    execute <<~SQL
      INSERT INTO time_period_locks (
        id, start_date, end_date, locked_at, locked_by_id, reason, created_at, updated_at
      )
      SELECT
        audit_logs.auditable_id,
        (audit_logs.metadata->>'start_date')::date,
        (audit_logs.metadata->>'end_date')::date,
        (audit_logs.metadata->>'locked_at')::timestamp,
        (audit_logs.metadata->>'locked_by_id')::bigint,
        audit_logs.metadata->>'reason',
        COALESCE((audit_logs.metadata->>'original_created_at')::timestamp, audit_logs.occurred_at),
        COALESCE((audit_logs.metadata->>'original_updated_at')::timestamp, audit_logs.occurred_at)
      FROM audit_logs
      WHERE audit_logs.action = 'legacy_time_period_lock.archived'
        AND audit_logs.auditable_type = 'TimePeriodLock'
        AND audit_logs.metadata->>'archived_by_migration' = '20260831011000'
        AND EXISTS (
          SELECT 1
          FROM users
          WHERE users.id = (audit_logs.metadata->>'locked_by_id')::bigint
        )
      ON CONFLICT (id) DO NOTHING
    SQL

    execute <<~SQL
      SELECT setval(
        pg_get_serial_sequence('time_period_locks', 'id'),
        COALESCE((SELECT MAX(id) FROM time_period_locks), 1),
        EXISTS (SELECT 1 FROM time_period_locks)
      )
    SQL
  end

  def restore_locked_time_entries
    execute <<~SQL
      UPDATE time_entries
      SET locked_at = archived.locked_at
      FROM (
        SELECT DISTINCT ON (auditable_id)
          auditable_id,
          (metadata->>'locked_at')::timestamp AS locked_at
        FROM audit_logs
        WHERE action = 'time_entry.legacy_lock_archived'
          AND auditable_type = 'TimeEntry'
          AND metadata->>'archived_by_migration' = '20260831011000'
        ORDER BY auditable_id, id DESC
      ) archived
      WHERE time_entries.id = archived.auditable_id
    SQL
  end
end
