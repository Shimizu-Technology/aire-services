# frozen_string_literal: true

class CreatePayrollCalendarPeriods < ActiveRecord::Migration[8.1]
  def change
    create_table :payroll_calendar_periods do |t|
      t.string :external_pay_period_id, null: false
      t.date :start_date, null: false
      t.date :end_date, null: false
      t.date :pay_date, null: false
      t.datetime :cutoff_at, null: false
      t.string :time_zone, null: false, default: "Pacific/Guam"
      t.integer :cutoff_days_before, null: false, default: 7
      t.integer :schedule_version, null: false
      t.uuid :publication_id, null: false
      t.string :request_checksum, null: false
      t.string :status, null: false, default: "scheduled"
      t.references :payroll_batch, foreign_key: { on_delete: :restrict }, index: { unique: true }
      t.datetime :finalized_at
      t.integer :finalization_attempts, null: false, default: 0
      t.datetime :last_finalization_attempt_at
      t.datetime :next_finalization_attempt_at
      t.string :last_finalization_error
      t.integer :lock_version, null: false, default: 0
      t.timestamps
    end

    add_index :payroll_calendar_periods, :external_pay_period_id, unique: true,
              name: "idx_payroll_calendar_periods_external_id"
    add_index :payroll_calendar_periods, [ :status, :cutoff_at, :next_finalization_attempt_at ],
              name: "idx_payroll_calendar_periods_due"
    add_check_constraint :payroll_calendar_periods,
                         "end_date >= start_date",
                         name: "check_payroll_calendar_period_date_order"
    add_check_constraint :payroll_calendar_periods,
                         "pay_date > end_date",
                         name: "check_payroll_calendar_period_pay_date"
    add_check_constraint :payroll_calendar_periods,
                         "cutoff_days_before = 7",
                         name: "check_payroll_calendar_period_cutoff_days"
    add_check_constraint :payroll_calendar_periods,
                         "time_zone = 'Pacific/Guam'",
                         name: "check_payroll_calendar_period_time_zone"
    add_check_constraint :payroll_calendar_periods,
                         <<~SQL.squish,
                           (((cutoff_at AT TIME ZONE 'UTC') AT TIME ZONE 'Pacific/Guam')::date =
                             pay_date - cutoff_days_before)
                         SQL
                         name: "check_payroll_calendar_period_cutoff_date"
    add_check_constraint :payroll_calendar_periods,
                         "schedule_version > 0",
                         name: "check_payroll_calendar_period_version"
    add_check_constraint :payroll_calendar_periods,
                         "status IN ('scheduled', 'failed', 'finalized')",
                         name: "check_payroll_calendar_period_status"
    add_check_constraint :payroll_calendar_periods,
                         <<~SQL.squish,
                           (
                             EXTRACT(DAY FROM start_date) = 1
                             AND EXTRACT(DAY FROM end_date) = 15
                             AND DATE_TRUNC('month', start_date::timestamp) = DATE_TRUNC('month', end_date::timestamp)
                           ) OR (
                             EXTRACT(DAY FROM start_date) = 16
                             AND end_date = (DATE_TRUNC('month', start_date::timestamp) + INTERVAL '1 month - 1 day')::date
                           )
                         SQL
                         name: "check_payroll_calendar_period_semimonthly"

    reversible do |direction|
      direction.up do
        execute <<~SQL
          ALTER TABLE payroll_calendar_periods
          ADD CONSTRAINT payroll_calendar_periods_no_overlap
          EXCLUDE USING gist (daterange(start_date, end_date, '[]') WITH &&);

          CREATE OR REPLACE FUNCTION protect_payroll_calendar_period_after_cutoff()
          RETURNS trigger AS $$
          BEGIN
            IF TG_OP = 'DELETE' THEN
              RAISE EXCEPTION 'payroll calendar periods cannot be deleted';
            END IF;

            IF OLD.status = 'finalized' THEN
              RAISE EXCEPTION 'finalized payroll calendar periods are immutable';
            END IF;

            IF (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') >= OLD.cutoff_at
               AND (
                 NEW.external_pay_period_id IS DISTINCT FROM OLD.external_pay_period_id
                 OR NEW.start_date IS DISTINCT FROM OLD.start_date
                 OR NEW.end_date IS DISTINCT FROM OLD.end_date
                 OR NEW.pay_date IS DISTINCT FROM OLD.pay_date
                 OR NEW.cutoff_at IS DISTINCT FROM OLD.cutoff_at
                 OR NEW.time_zone IS DISTINCT FROM OLD.time_zone
                 OR NEW.cutoff_days_before IS DISTINCT FROM OLD.cutoff_days_before
                 OR NEW.schedule_version IS DISTINCT FROM OLD.schedule_version
                 OR NEW.publication_id IS DISTINCT FROM OLD.publication_id
                 OR NEW.request_checksum IS DISTINCT FROM OLD.request_checksum
               ) THEN
              RAISE EXCEPTION 'payroll calendar schedules cannot change after cutoff';
            END IF;

            RETURN NEW;
          END;
          $$ LANGUAGE plpgsql;

          CREATE TRIGGER payroll_calendar_periods_cutoff_guard
          BEFORE UPDATE OR DELETE ON payroll_calendar_periods
          FOR EACH ROW EXECUTE FUNCTION protect_payroll_calendar_period_after_cutoff();
        SQL
      end

      direction.down do
        execute "DROP TRIGGER IF EXISTS payroll_calendar_periods_cutoff_guard ON payroll_calendar_periods"
        execute "DROP FUNCTION IF EXISTS protect_payroll_calendar_period_after_cutoff()"
        execute "ALTER TABLE payroll_calendar_periods DROP CONSTRAINT IF EXISTS payroll_calendar_periods_no_overlap"
      end
    end

    create_table :payroll_calendar_period_revisions do |t|
      t.references :payroll_calendar_period, null: false, foreign_key: { on_delete: :restrict },
                   index: { name: "idx_payroll_calendar_revisions_period" }
      t.integer :schedule_version, null: false
      t.uuid :publication_id, null: false
      t.string :request_checksum, null: false
      t.jsonb :payload, null: false, default: {}
      t.datetime :published_at, null: false
      t.timestamps
    end

    add_index :payroll_calendar_period_revisions,
              [ :payroll_calendar_period_id, :schedule_version ],
              unique: true,
              name: "idx_payroll_calendar_revisions_period_version"
    add_index :payroll_calendar_period_revisions, :publication_id, unique: true,
              name: "idx_payroll_calendar_revisions_publication"
    add_check_constraint :payroll_calendar_period_revisions,
                         "schedule_version > 0",
                         name: "check_payroll_calendar_revision_version"

    create_table :payroll_outbox_events do |t|
      t.uuid :event_id, null: false, default: -> { "gen_random_uuid()" }
      t.string :event_type, null: false
      t.references :payroll_calendar_period, null: false, foreign_key: { on_delete: :restrict },
                   index: { name: "idx_payroll_outbox_period" }
      t.jsonb :payload, null: false, default: {}
      t.datetime :occurred_at, null: false
      t.string :delivery_status, null: false, default: "pending"
      t.integer :delivery_attempts, null: false, default: 0
      t.datetime :last_delivery_attempt_at
      t.datetime :next_delivery_attempt_at
      t.datetime :delivery_enqueued_until
      t.datetime :delivered_at
      t.integer :last_response_status
      t.string :last_error
      t.integer :lock_version, null: false, default: 0
      t.timestamps
    end

    add_index :payroll_outbox_events, :event_id, unique: true
    add_index :payroll_outbox_events, [ :delivery_status, :next_delivery_attempt_at, :delivery_enqueued_until ],
              name: "idx_payroll_outbox_due"
    add_check_constraint :payroll_outbox_events,
                         "delivery_status IN ('pending', 'failed', 'delivered')",
                         name: "check_payroll_outbox_delivery_status"
    add_check_constraint :payroll_outbox_events,
                         "delivery_attempts >= 0",
                         name: "check_payroll_outbox_delivery_attempts"

    reversible do |direction|
      direction.up do
        execute <<~SQL
          CREATE OR REPLACE FUNCTION protect_payroll_calendar_revision()
          RETURNS trigger AS $$
          BEGIN
            RAISE EXCEPTION 'payroll calendar revisions are append-only';
          END;
          $$ LANGUAGE plpgsql;

          CREATE TRIGGER payroll_calendar_period_revisions_append_only
          BEFORE UPDATE OR DELETE ON payroll_calendar_period_revisions
          FOR EACH ROW EXECUTE FUNCTION protect_payroll_calendar_revision();

          CREATE OR REPLACE FUNCTION protect_payroll_outbox_payload()
          RETURNS trigger AS $$
          BEGIN
            IF TG_OP = 'DELETE' THEN
              RAISE EXCEPTION 'payroll outbox events cannot be deleted';
            END IF;

            IF NEW.event_id IS DISTINCT FROM OLD.event_id
               OR NEW.event_type IS DISTINCT FROM OLD.event_type
               OR NEW.payroll_calendar_period_id IS DISTINCT FROM OLD.payroll_calendar_period_id
               OR NEW.payload IS DISTINCT FROM OLD.payload
               OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
               OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
              RAISE EXCEPTION 'payroll outbox event payloads are immutable';
            END IF;

            RETURN NEW;
          END;
          $$ LANGUAGE plpgsql;

          CREATE TRIGGER payroll_outbox_events_payload_immutable
          BEFORE UPDATE OR DELETE ON payroll_outbox_events
          FOR EACH ROW EXECUTE FUNCTION protect_payroll_outbox_payload();
        SQL
      end

      direction.down do
        execute "DROP TRIGGER IF EXISTS payroll_outbox_events_payload_immutable ON payroll_outbox_events"
        execute "DROP FUNCTION IF EXISTS protect_payroll_outbox_payload()"
        execute "DROP TRIGGER IF EXISTS payroll_calendar_period_revisions_append_only ON payroll_calendar_period_revisions"
        execute "DROP FUNCTION IF EXISTS protect_payroll_calendar_revision()"
      end
    end
  end
end
