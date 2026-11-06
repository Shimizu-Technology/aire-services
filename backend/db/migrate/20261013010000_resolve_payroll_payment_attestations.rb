# frozen_string_literal: true

class ResolvePayrollPaymentAttestations < ActiveRecord::Migration[8.1]
  def up
    add_column :payroll_payment_attestations, :resolved_at, :datetime
    add_reference :payroll_payment_attestations, :resolved_by, foreign_key: { to_table: :users }
    add_column :payroll_payment_attestations, :resolution_reason, :text
    add_reference :payroll_payment_attestations, :resolved_manual_allocation, foreign_key: { to_table: :payroll_manual_allocations }, index: { name: "idx_attestation_resolved_allocation" }
    add_reference :payroll_payment_attestations, :resolved_issued_event, foreign_key: { to_table: :payroll_manual_allocation_events }, index: { name: "idx_attestation_resolved_issue" }
    add_column :payroll_payment_attestations, :resolution_evidence, :jsonb, null: false, default: {}
    remove_check_constraint :payroll_payment_attestations, name: "payment_attestation_valid_state"
    remove_check_constraint :payroll_payment_attestations, name: "payment_attestation_retraction_complete"
    add_check_constraint :payroll_payment_attestations, "hours > 0 AND status IN ('pending_evidence', 'retracted', 'resolved')", name: "payment_attestation_valid_state"
    add_check_constraint :payroll_payment_attestations, <<~SQL.squish, name: "payment_attestation_retraction_complete"
      (status = 'pending_evidence' AND retracted_at IS NULL AND retracted_by_id IS NULL AND retraction_reason IS NULL
        AND resolved_at IS NULL AND resolved_by_id IS NULL AND resolution_reason IS NULL AND resolved_manual_allocation_id IS NULL AND resolved_issued_event_id IS NULL AND resolution_evidence = '{}') OR
      (status = 'retracted' AND retracted_at IS NOT NULL AND retracted_by_id IS NOT NULL AND retraction_reason IS NOT NULL
        AND resolved_at IS NULL AND resolved_by_id IS NULL AND resolution_reason IS NULL AND resolved_manual_allocation_id IS NULL AND resolved_issued_event_id IS NULL AND resolution_evidence = '{}') OR
      (status = 'resolved' AND retracted_at IS NULL AND retracted_by_id IS NULL AND retraction_reason IS NULL
        AND resolved_at IS NOT NULL AND resolved_by_id IS NOT NULL AND resolution_reason IS NOT NULL AND resolved_manual_allocation_id IS NOT NULL AND resolved_issued_event_id IS NOT NULL
        AND jsonb_typeof(resolution_evidence) = 'object'
        AND COALESCE(resolution_evidence->>'expected_weekly_context_fingerprint', '') ~ '^[0-9a-f]{64}$'
        AND COALESCE(resolution_evidence->>'payroll_payment_event_type', '') IN ('delivered_check', 'direct_deposit_confirmation')
        AND length(COALESCE(resolution_evidence->>'payroll_payment_event_id', '')) BETWEEN 1 AND 200)
    SQL
    remove_check_constraint :payroll_payment_attestation_events, name: "payment_attestation_event_type"
    add_check_constraint :payroll_payment_attestation_events, "event_type IN ('attested', 'retracted', 'resolved')", name: "payment_attestation_event_type"
    execute <<~SQL
      CREATE FUNCTION protect_payroll_payment_attestation_history() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
          RAISE EXCEPTION 'Payment report history is append-only';
        END IF;
        IF (to_jsonb(NEW) - ARRAY['status', 'retracted_at', 'retracted_by_id', 'retraction_reason', 'resolved_at', 'resolved_by_id', 'resolution_reason', 'resolved_manual_allocation_id', 'resolved_issued_event_id', 'resolution_evidence', 'lock_version', 'updated_at'])
            IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'retracted_at', 'retracted_by_id', 'retraction_reason', 'resolved_at', 'resolved_by_id', 'resolution_reason', 'resolved_manual_allocation_id', 'resolved_issued_event_id', 'resolution_evidence', 'lock_version', 'updated_at'])
            OR OLD.status <> 'pending_evidence' THEN
          RAISE EXCEPTION 'Payment report history and resolution anchors are immutable';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER payroll_payment_attestation_history_immutable BEFORE UPDATE OR DELETE ON payroll_payment_attestations FOR EACH ROW EXECUTE FUNCTION protect_payroll_payment_attestation_history();
      CREATE TRIGGER payroll_payment_attestation_history_prevent_truncate BEFORE TRUNCATE ON payroll_payment_attestations FOR EACH STATEMENT EXECUTE FUNCTION protect_payroll_payment_attestation_history();
    SQL
  end

  def down
    raise ActiveRecord::IrreversibleMigration, "Resolved payment report history must be preserved"
  end
end
