# frozen_string_literal: true

class CreatePayrollEntryProcessingEvents < ActiveRecord::Migration[8.1]
  def change
    create_table :payroll_entry_processing_events do |t|
      t.references :payroll_batch, null: false, foreign_key: { on_delete: :cascade }
      t.string :event_id, null: false
      t.bigint :source_time_entry_id, null: false
      t.uuid :source_user_uuid
      t.string :status, null: false
      t.string :external_system, null: false
      t.string :external_pay_period_id
      t.string :external_payroll_item_id
      t.string :payment_method
      t.string :payment_reference
      t.datetime :occurred_at, null: false
      t.jsonb :metadata, null: false, default: {}
      t.timestamps
    end

    add_index :payroll_entry_processing_events, :event_id, unique: true
    add_index :payroll_entry_processing_events,
              [ :source_time_entry_id, :occurred_at ],
              name: "idx_payroll_entry_processing_events_entry_time"
    add_index :payroll_entry_processing_events,
              [ :payroll_batch_id, :status, :occurred_at ],
              name: "idx_payroll_entry_processing_events_batch_status"

    reversible do |direction|
      direction.up do
        execute <<~SQL
          CREATE TRIGGER payroll_entry_processing_events_append_only
          BEFORE UPDATE OR DELETE ON payroll_entry_processing_events
          FOR EACH ROW EXECUTE FUNCTION protect_finalized_payroll_records();
        SQL
      end

      direction.down do
        execute "DROP TRIGGER IF EXISTS payroll_entry_processing_events_append_only ON payroll_entry_processing_events"
      end
    end
  end
end
