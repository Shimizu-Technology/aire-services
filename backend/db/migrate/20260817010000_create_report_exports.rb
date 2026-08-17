# frozen_string_literal: true

class CreateReportExports < ActiveRecord::Migration[8.1]
  def change
    create_table :report_exports do |t|
      t.string :public_id, null: false
      t.string :export_type, null: false
      t.string :readiness_status, null: false
      t.string :state, null: false, default: "active"
      t.date :start_date, null: false
      t.date :end_date, null: false
      t.references :generated_by, foreign_key: { to_table: :users }, null: true
      t.jsonb :employee_ids, null: false, default: []
      t.jsonb :entry_ids, null: false, default: []
      t.jsonb :filters, null: false, default: {}
      t.jsonb :summary, null: false, default: {}
      t.jsonb :issues, null: false, default: {}
      t.jsonb :entry_snapshot, null: false, default: []
      t.string :checksum, null: false
      t.boolean :protects_entries, null: false, default: false
      t.datetime :generated_at, null: false
      t.datetime :stale_at
      t.text :stale_reason
      t.integer :download_count, null: false, default: 1
      t.datetime :last_downloaded_at, null: false

      t.timestamps
    end

    add_index :report_exports, :public_id, unique: true
    add_index :report_exports, [ :export_type, :start_date, :end_date ]
    add_index :report_exports, [ :protects_entries, :state ]
    add_index :report_exports, :entry_ids, using: :gin
    add_index :report_exports, :employee_ids, using: :gin
    add_index :report_exports, :checksum
  end
end
