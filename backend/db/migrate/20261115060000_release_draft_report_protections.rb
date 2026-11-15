# frozen_string_literal: true

# Older downloads called category-ready reports "complete" even with waiting
# hours. Preserve their snapshot/checksum and release only draft protection.
class ReleaseDraftReportProtections < ActiveRecord::Migration[8.1]
  def up
    execute "SET LOCAL lock_timeout = '5s'"
    execute <<~SQL
      UPDATE report_exports
      SET protects_entries = FALSE, readiness_status = 'draft'
      WHERE protects_entries = TRUE AND (
        readiness_status = 'draft' OR
        COALESCE((summary->>'open_clock_count')::numeric, 0) > 0 OR
        COALESCE((summary->>'uncategorized_count')::numeric, 0) > 0 OR
        CASE WHEN summary->'payroll_hours' ? 'time_waiting_hours'
          AND summary->'payroll_hours' ? 'overtime_waiting_hours'
        THEN COALESCE((summary->'payroll_hours'->>'time_waiting_hours')::numeric, 0) > 0
          OR COALESCE((summary->'payroll_hours'->>'overtime_waiting_hours')::numeric, 0) > 0
        ELSE COALESCE((summary->>'pending_count')::numeric, 0) > 0
          OR COALESCE((summary->>'pending_overtime_count')::numeric, 0) > 0
        END
      )
    SQL
  end

  def down
    raise ActiveRecord::IrreversibleMigration, "Draft reports must not protect shifts"
  end
end
