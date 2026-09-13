# frozen_string_literal: true

class CreatePayrollSettlementCases < ActiveRecord::Migration[8.0]
  def change
    create_table :payroll_settlement_cases do |t|
      t.uuid :public_id, null: false, default: -> { "gen_random_uuid()" }
      t.bigint :source_time_entry_id, null: false
      t.integer :source_time_entry_version, null: false, default: 0
      t.bigint :source_user_id, null: false
      t.uuid :source_user_uuid
      t.references :origin_payroll_batch, null: false, foreign_key: { to_table: :payroll_batches, on_delete: :restrict }
      t.references :origin_payroll_batch_exclusion,
                   foreign_key: { to_table: :payroll_batch_exclusions, on_delete: :restrict },
                   index: false
      t.references :supersedes_case,
                   foreign_key: { to_table: :payroll_settlement_cases, on_delete: :restrict }
      t.references :target_payroll_calendar_period,
                   foreign_key: { to_table: :payroll_calendar_periods, on_delete: :restrict },
                   index: { name: "idx_payroll_settlement_cases_target_period" }
      t.references :included_payroll_batch,
                   foreign_key: { to_table: :payroll_batches, on_delete: :restrict },
                   index: { name: "idx_payroll_settlement_cases_included_batch" }
      t.references :assigned_to, foreign_key: { to_table: :users, on_delete: :nullify }
      t.string :origin_reason, null: false
      t.date :original_work_date, null: false
      t.decimal :held_total_hours, precision: 8, scale: 2, null: false, default: 0
      t.string :destination_kind, null: false, default: "unassigned"
      t.string :target_external_pay_period_id
      t.string :owner_role, null: false, default: "aire_admins"
      t.date :action_due_on, null: false
      t.string :status, null: false, default: "open"
      t.text :resolution_note
      t.datetime :resolved_at
      t.integer :lock_version, null: false, default: 0
      t.jsonb :source_snapshot, null: false, default: {}
      t.timestamps
    end

    add_index :payroll_settlement_cases, :public_id, unique: true
    add_index :payroll_settlement_cases, [ :status, :action_due_on ], name: "idx_payroll_settlement_cases_work_queue"
    add_index :payroll_settlement_cases, :source_time_entry_id
    add_index :payroll_settlement_cases,
              :origin_payroll_batch_exclusion_id,
              unique: true,
              where: "origin_payroll_batch_exclusion_id IS NOT NULL",
              name: "idx_payroll_settlement_cases_origin_exclusion_unique"
    add_index :payroll_settlement_cases,
              [ :origin_payroll_batch_id, :source_time_entry_id, :origin_reason, :source_time_entry_version ],
              unique: true,
              where: "origin_payroll_batch_exclusion_id IS NULL",
              name: "idx_payroll_settlement_cases_synthetic_origin_unique"
    add_check_constraint :payroll_settlement_cases,
                         "held_total_hours >= 0",
                         name: "check_payroll_settlement_cases_hours"
    add_check_constraint :payroll_settlement_cases,
                         "destination_kind IN ('unassigned', 'regular', 'supplemental', 'not_payable')",
                         name: "check_payroll_settlement_cases_destination"
    add_check_constraint :payroll_settlement_cases,
                         "status IN ('open', 'scheduled', 'in_payroll', 'settled', 'not_payable', 'superseded')",
                         name: "check_payroll_settlement_cases_status"
    add_check_constraint :payroll_settlement_cases,
                         "owner_role = 'aire_admins'",
                         name: "check_payroll_settlement_cases_owner_role"
    add_check_constraint :payroll_settlement_cases,
                         "jsonb_typeof(source_snapshot) = 'object'",
                         name: "check_payroll_settlement_cases_snapshot"
    add_check_constraint :payroll_settlement_cases,
                         <<~SQL.squish,
                           (destination_kind = 'regular' AND target_payroll_calendar_period_id IS NOT NULL AND target_external_pay_period_id IS NOT NULL)
                           OR (destination_kind = 'supplemental' AND target_payroll_calendar_period_id IS NULL AND target_external_pay_period_id IS NOT NULL)
                           OR (destination_kind = 'unassigned' AND target_payroll_calendar_period_id IS NULL AND target_external_pay_period_id IS NULL AND status = 'open')
                           OR (destination_kind = 'not_payable' AND target_payroll_calendar_period_id IS NULL AND target_external_pay_period_id IS NULL AND status = 'not_payable')
                         SQL
                         name: "check_payroll_settlement_cases_routing_shape"
    add_check_constraint :payroll_settlement_cases,
                         "status NOT IN ('in_payroll', 'settled') OR destination_kind = 'supplemental' OR included_payroll_batch_id IS NOT NULL",
                         name: "check_payroll_settlement_cases_included_shape"
    add_check_constraint :payroll_settlement_cases,
                         "(status IN ('settled', 'not_payable', 'superseded')) = (resolved_at IS NOT NULL)",
                         name: "check_payroll_settlement_cases_resolution_shape"

    create_table :payroll_settlement_case_events do |t|
      t.references :payroll_settlement_case, null: false,
                   foreign_key: { on_delete: :restrict },
                   index: { name: "idx_payroll_settlement_case_events_case" }
      t.uuid :event_id, null: false
      t.references :actor, foreign_key: { to_table: :users, on_delete: :restrict }
      t.uuid :actor_payroll_integration_uuid
      t.string :event_type, null: false
      t.string :from_status
      t.string :to_status, null: false
      t.datetime :occurred_at, null: false
      t.jsonb :metadata, null: false, default: {}
      t.timestamps
    end

    add_index :payroll_settlement_case_events, :event_id, unique: true
    add_index :payroll_settlement_case_events,
              [ :payroll_settlement_case_id, :occurred_at ],
              name: "idx_payroll_settlement_case_events_timeline"
    add_check_constraint :payroll_settlement_case_events,
                         "jsonb_typeof(metadata) = 'object'",
                         name: "check_payroll_settlement_case_events_metadata"
    add_check_constraint :payroll_settlement_case_events,
                         "event_type IN ('opened', 'routed', 'rerouted', 'corrected', 'approval_changed', 'included', 'imported', 'committed', 'payment_prepared', 'payment_issued', 'payment_failed', 'payment_voided', 'payment_returned', 'settled', 'marked_not_payable', 'superseded')",
                         name: "check_payroll_settlement_case_events_type"
    add_check_constraint :payroll_settlement_case_events,
                         "from_status IS NULL OR from_status IN ('open', 'scheduled', 'in_payroll', 'settled', 'not_payable', 'superseded')",
                         name: "check_payroll_settlement_case_events_from_status"
    add_check_constraint :payroll_settlement_case_events,
                         "to_status IN ('open', 'scheduled', 'in_payroll', 'settled', 'not_payable', 'superseded')",
                         name: "check_payroll_settlement_case_events_to_status"

    remove_check_constraint :payroll_integration_grants,
                            "capabilities <@ ARRAY['time_approval', 'payroll_finalization']::varchar[]",
                            name: "check_payroll_integration_grant_capabilities"
    add_check_constraint :payroll_integration_grants,
                         "capabilities <@ ARRAY['time_approval', 'payroll_finalization', 'time_correction', 'settlement_case_management']::varchar[]",
                         name: "check_payroll_integration_grant_capabilities"

    reversible do |direction|
      direction.up do
        execute <<~SQL
          CREATE TRIGGER payroll_settlement_case_events_append_only
          BEFORE UPDATE OR DELETE ON payroll_settlement_case_events
          FOR EACH ROW EXECUTE FUNCTION protect_finalized_payroll_records();

          CREATE TRIGGER payroll_settlement_case_events_prevent_truncate
          BEFORE TRUNCATE ON payroll_settlement_case_events
          FOR EACH STATEMENT EXECUTE FUNCTION protect_finalized_payroll_records();
        SQL
      end

      direction.down do
        execute <<~SQL
          DROP TRIGGER IF EXISTS payroll_settlement_case_events_append_only ON payroll_settlement_case_events;
          DROP TRIGGER IF EXISTS payroll_settlement_case_events_prevent_truncate ON payroll_settlement_case_events;
        SQL
      end
    end
  end
end
