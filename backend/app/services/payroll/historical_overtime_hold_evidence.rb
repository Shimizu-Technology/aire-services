# frozen_string_literal: true

module Payroll
  # Complete accounting for a frozen pending-OT remainder, never payment coverage.
  # The general LegacyPaidHistoryGuard still considers these hours unpaid.
  class HistoricalOvertimeHoldEvidence
    def initialize(entries:, rows: nil, exclusions: nil)
      ids = entries.map(&:id)
      @batch_checksums = {}
      @rows = (rows || PayrollBatchEntry.effective.where(source_time_entry_id: ids).includes(:payroll_batch).to_a).group_by(&:source_time_entry_id)
      @exclusions = (exclusions || PayrollBatchExclusion.where(source_time_entry_id: ids).includes(:payroll_batch).to_a).group_by(&:source_time_entry_id)
    end

    def call(entry)
      return nil unless entry.status == "completed" && entry.approval_status == "approved" &&
        entry.overtime_status.in?([ nil, "none", "pending" ]) && entry.user&.payroll_integration_uuid.present?

      rows = @rows.fetch(entry.id, [])
      exclusions = @exclusions.fetch(entry.id, [])
      return nil unless exclusions.one?

      hold = exclusions.sole
      batch = hold.payroll_batch
      return nil unless @batch_checksums.fetch(batch.id) { @batch_checksums[batch.id] = CanonicalPayload.checksum(batch.payload) == batch.checksum } &&
        rows.all? { |row| row.payroll_batch_id == batch.id && row.overtime_hours.zero? && row.regular_hours.positive? &&
          row.source_user_id == entry.user_id && row.source_user_uuid == entry.user.payroll_integration_uuid &&
          row.work_date == entry.work_date && !PayableContent.changed_from_snapshot?(entry, row.snapshot) }
      return nil unless hold.reason == "pending_overtime" && hold.held_regular_hours.zero? && hold.held_overtime_hours.positive? &&
        hold.held_overtime_hours == hold.held_total_hours && hold.source_user_id == entry.user_id &&
        hold.source_user_uuid == entry.user.payroll_integration_uuid && hold.snapshot["work_date"] == entry.work_date.iso8601 &&
        hold.snapshot["allocation_hold"].nil? && hold.snapshot["payable_content_checksum"].present? &&
        !PayableContent.changed_from_snapshot?(entry, hold.snapshot) &&
        rows.sum(BigDecimal("0"), &:regular_hours) + hold.held_total_hours == entry.hours

      frozen_rows = batch.payload.fetch("employees").flat_map do |owner|
        owner.fetch("adjustments").filter_map do |line|
          [ owner, line ] if line["source_time_entry_id"] == entry.id.to_s
        end
      end
      return nil unless frozen_rows.length == rows.length && frozen_rows.map { |_, line| line["line_key"] }.uniq.length == rows.length &&
        frozen_rows.all? do |owner, line|
          row = rows.find { |record| record.line_key == line["line_key"] }
          row && owner["source_user_id"] == entry.user_id.to_s && owner["source_user_uuid"] == entry.user.payroll_integration_uuid &&
            line["source_time_entry_version"] == row.snapshot["version"] && line["source_kind"] == row.source_kind &&
            line["original_work_date"] == entry.work_date.iso8601 && line["category"] == row.snapshot["time_category"] &&
            %w[total_hours regular_hours overtime_hours].all? { |key| BigDecimal(line.fetch(key).to_s) == row.public_send(key) }
        end

      payload_holds = Array(batch.payload["exclusions"]).select { |row| row["source_time_entry_id"] == entry.id.to_s }
      return nil unless payload_holds.one?

      frozen = payload_holds.sole
      return nil unless frozen["reason"] == hold.reason && frozen["source_user_id"] == entry.user_id.to_s &&
        frozen["source_user_uuid"] == entry.user.payroll_integration_uuid && frozen["original_work_date"] == entry.work_date.iso8601 &&
        frozen["category"] == hold.snapshot["time_category"] && frozen["allocation_review_reason"].nil? &&
        %w[held_total_hours held_regular_hours held_overtime_hours].all? { |key| BigDecimal(frozen.fetch(key).to_s) == hold.public_send(key) }

      { kind: "pending_overtime", batch_id: batch.public_id, batch_checksum: batch.checksum,
        source_time_entry_version: entry.lock_version, payable_content_checksum: PayableContent.checksum(entry),
        represented_regular_hours: rows.sum(BigDecimal("0"), &:regular_hours).to_s("F"),
        frozen_exclusion: frozen.except("display_name", "email") }
    rescue KeyError, ArgumentError, TypeError
      nil
    end
  end
end
