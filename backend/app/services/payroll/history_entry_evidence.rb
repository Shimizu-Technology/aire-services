# frozen_string_literal: true

module Payroll
  # Read-only, request-scoped evidence. Processing is deliberately separate
  # from payment: no handout can be inferred from a manual batch commit.
  class HistoryEntryEvidence
    def initialize(entries:)
      @entries = entries
    end

    def call
      ids = @entries.map(&:id)
      rows = PayrollBatchEntry.effective.where(source_time_entry_id: ids)
        .includes(payroll_batch: :payroll_batch_processing_events).order(:id).to_a
      rows_by_entry = rows.group_by(&:source_time_entry_id)
      @legacy_frozen_evidence = LegacyFrozenBatchEvidence.new(rows: rows.reject { |row| row.snapshot["payable_content_checksum"].present? })
      legacy = ManualBatchCorrectionReview.legacy_revision_baselines(rows.index_by(&:source_time_entry_id))
      allocations = PayrollManualAllocation.where(time_entry_id: ids).where.not(status: "voided").group_by(&:time_entry_id)
      reports = PayrollPaymentAttestation.pending_evidence.includes(:time_entry, :user).where(time_entry_id: ids).index_by(&:time_entry_id)
      cases = PayrollSettlementCase.active.where(source_time_entry_id: ids).group_by(&:source_time_entry_id)
      @entries.index_with do |entry|
        {
          payable_content_checksum: PayableContent.checksum(entry),
          baseline_lines: rows_by_entry.fetch(entry.id, []).map { |row| baseline_line(row, entry, legacy[entry.id]) },
          active_manual_allocation_ids: allocations.fetch(entry.id, []).map { |row| row.id.to_s }.sort,
          payment_attestation: reports[entry.id]&.then do |report|
            { id: report.id.to_s, hours: report.hours.to_s, source_changed: report.source_changed? }
          end,
          active_cases: cases.fetch(entry.id, []).map do |record|
            { id: record.public_id, version: record.source_time_entry_version,
              status: record.status, destination_kind: record.destination_kind,
              source_user_uuid: record.source_user_uuid, held_total_hours: record.held_total_hours.to_s }
          end
        }
      end.transform_keys(&:id)
    end

    private

    def baseline_line(row, entry, legacy)
      batch = row.payroll_batch
      events = batch.payroll_batch_processing_events.to_a
      manual_events = events.select { |event| event.status == "committed" && event.external_system == "cornerstone_payroll_manual" }
      event = manual_events.max_by { |record| [ record.occurred_at, record.id ] }
      processing = event && { event_id: event.event_id, status: event.status, external_system: event.external_system,
        external_pay_period_id: event.external_pay_period_id, occurred_at: event.occurred_at.iso8601 }
      conflict = event.nil? || events.any? do |record|
        record.external_pay_period_id != event.external_pay_period_id || record.status != "committed"
      end
      original_version = row.snapshot["version"]
      original_chronology = original_version.is_a?(Integer) && legacy && legacy.source_version == original_version && legacy.recorded_at <= batch.cutoff_at
      known_content = row.snapshot["payable_content_checksum"].present? || original_chronology
      legacy_uuid = entry.user&.payroll_integration_uuid if entry.user_id == row.source_user_id

      {
        batch_id: batch.public_id, batch_checksum: batch.checksum,
        batch_start_date: batch.start_date.iso8601, batch_end_date: batch.end_date.iso8601,
        processing: processing, processing_conflict: conflict,
        snapshot_checksum: CanonicalPayload.checksum(row.snapshot),
        legacy_frozen_evidence: row.snapshot["payable_content_checksum"].blank? ? @legacy_frozen_evidence.call(row: row, entry: entry) : nil,
        source_time_entry_id: row.source_time_entry_id.to_s,
        source_user_uuid: row.source_user_uuid || row.snapshot["user_uuid"] ||
          legacy_uuid,
        source_user_id: row.source_user_id.to_s,
        identity_basis: (row.source_user_uuid || row.snapshot["user_uuid"]) ? "frozen_uuid" : "reviewed_legacy_owner",
        source_comparison: row.snapshot["payable_content_checksum"].present? ? "checksummed_content" : "legacy_observation",
        source_time_entry_version: row.snapshot["version"],
        line_key: row.line_key, source_kind: row.source_kind,
        work_date: row.work_date.iso8601, category: row.snapshot["time_category"],
        total_hours: row.total_hours.to_s, regular_hours: row.regular_hours.to_s,
        overtime_hours: row.overtime_hours.to_s,
        payable_content_checksum: row.snapshot["payable_content_checksum"],
        current_content_matches: !!known_content && !PayableContent.changed_from_snapshot?(entry, row.snapshot,
          legacy_baseline: legacy&.time_entry_state)
      }
    end
  end
end
