# frozen_string_literal: true

class CreatePayrollPaymentAttestations < ActiveRecord::Migration[8.1]
  def change
    create_table :payroll_payment_attestations do |t|
      t.references :time_entry, null: false, foreign_key: true, index: { unique: true }
      t.references :user, null: false, foreign_key: true
      t.references :recorded_by, null: false, foreign_key: { to_table: :users }
      t.uuid :source_user_uuid, null: false
      t.integer :source_time_entry_version, null: false
      t.date :work_date, null: false
      t.decimal :hours, precision: 8, scale: 2, null: false
      t.string :status, null: false, default: "pending_evidence"
      t.text :reason, null: false
      t.datetime :attested_at, null: false
      t.datetime :retracted_at
      t.references :retracted_by, foreign_key: { to_table: :users }
      t.text :retraction_reason
      t.integer :lock_version, null: false, default: 0
      t.timestamps
    end

    add_check_constraint :payroll_payment_attestations,
                         "hours > 0 AND status IN ('pending_evidence', 'retracted')",
                         name: "payment_attestation_valid_state"
    add_check_constraint :payroll_payment_attestations,
                         "(status = 'pending_evidence' AND retracted_at IS NULL AND retracted_by_id IS NULL AND retraction_reason IS NULL) OR " \
                         "(status = 'retracted' AND retracted_at IS NOT NULL AND retracted_by_id IS NOT NULL AND retraction_reason IS NOT NULL)",
                         name: "payment_attestation_retraction_complete"

    create_table :payroll_payment_attestation_events do |t|
      t.references :payroll_payment_attestation, null: false, foreign_key: true,
                   index: { name: "index_payment_attestation_events_on_attestation" }
      t.references :actor, null: false, foreign_key: { to_table: :users }
      t.string :event_type, null: false
      t.datetime :occurred_at, null: false
      t.text :reason, null: false
      t.timestamps
    end
    add_check_constraint :payroll_payment_attestation_events,
                         "event_type IN ('attested', 'retracted')",
                         name: "payment_attestation_event_type"

    reversible do |direction|
      direction.up do
        execute <<~SQL
          CREATE TRIGGER payroll_payment_attestation_events_append_only
          BEFORE UPDATE OR DELETE ON payroll_payment_attestation_events
          FOR EACH ROW EXECUTE FUNCTION protect_finalized_payroll_records();

          CREATE TRIGGER payroll_payment_attestation_events_prevent_truncate
          BEFORE TRUNCATE ON payroll_payment_attestation_events
          FOR EACH STATEMENT EXECUTE FUNCTION protect_finalized_payroll_records();
        SQL
      end
      direction.down do
        execute <<~SQL
          DROP TRIGGER IF EXISTS payroll_payment_attestation_events_append_only ON payroll_payment_attestation_events;
          DROP TRIGGER IF EXISTS payroll_payment_attestation_events_prevent_truncate ON payroll_payment_attestation_events;
        SQL
      end
    end
  end
end
