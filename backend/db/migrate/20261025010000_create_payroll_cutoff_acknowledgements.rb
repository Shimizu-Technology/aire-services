# frozen_string_literal: true

class CreatePayrollCutoffAcknowledgements < ActiveRecord::Migration[8.0]
  def change
    create_table :payroll_cutoff_acknowledgements do |t|
      t.references :user, null: false, foreign_key: true
      t.references :payroll_calendar_period, null: false, foreign_key: true
      t.uuid :publication_id, null: false
      t.integer :publication_version, null: false
      t.string :stage, null: false
      t.timestamps
    end
    add_index :payroll_cutoff_acknowledgements,
              [ :user_id, :payroll_calendar_period_id, :publication_id, :publication_version, :stage ],
              unique: true, name: "index_payroll_cutoff_ack_identity"
    add_check_constraint :payroll_cutoff_acknowledgements, "stage IN ('24h', '4h')", name: "payroll_cutoff_ack_stage"
  end
end
