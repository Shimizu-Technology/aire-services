# frozen_string_literal: true

module Payroll
  # Pre-calendar paid snapshots have no calendar for the ordinary coordinator
  # to reconcile. Keep later changes visible, but require an operator to name
  # their destination before any scheduled cutoff can include them.
  class ManualBatchCorrectionReview
    def self.call
      PayrollBatch.regular.joins(:payroll_batch_processing_events)
        .where(payroll_batch_processing_events: { status: "committed", external_system: "cornerstone_payroll_manual" })
        .where.not(id: PayrollCalendarPeriod.where.not(payroll_batch_id: nil).select(:payroll_batch_id))
        .distinct.find_each do |batch|
          grouped = batch.payroll_batch_entries.group_by(&:source_time_entry_id)
          entries = TimeEntry.where(id: grouped.keys).includes(:time_entry_breaks).index_by(&:id)
          latest_snapshots = PayrollBatchEntry.effective.where(source_time_entry_id: grouped.keys)
            .joins(:payroll_batch).select("DISTINCT ON (source_time_entry_id) payroll_batch_entries.*")
            .order("source_time_entry_id, payroll_batches.cutoff_at DESC, payroll_batch_entries.id DESC")
            .index_by(&:source_time_entry_id)
          legacy_baselines = legacy_revision_baselines(latest_snapshots)
          grouped.each do |entry_id, rows|
            entry = entries[entry_id]
            latest_snapshot = latest_snapshots[entry_id]&.snapshot || rows.first.snapshot
            known_chronology = latest_snapshot["payable_content_checksum"].present? || legacy_baselines.key?(entry_id)
            next if entry && known_chronology && !PayableContent.changed_from_snapshot?(entry, latest_snapshot,
              legacy_baseline: legacy_baselines[entry_id]&.time_entry_state)

            reason = entry ? "changed_after_cutoff" : "deleted_after_cutoff"
            version = entry&.lock_version || rows.map { |row| row.snapshot.fetch("version", 0).to_i }.max + 1
            next if PayrollSettlementCase.exists?(origin_payroll_batch: batch, source_time_entry_id: entry_id,
              source_time_entry_version: version, origin_reason: reason)
            next if PayrollSettlementCase.active.exists?(origin_payroll_batch: batch, source_time_entry_id: entry_id)

            row = rows.first
            PayrollSettlementCase.transaction(requires_new: true) do
              settlement_case = PayrollSettlementCase.create!(
                origin_payroll_batch: batch, source_time_entry_id: entry_id, source_time_entry_version: version,
                source_user_id: row.source_user_id, source_user_uuid: row.source_user_uuid,
                origin_reason: reason, original_work_date: row.work_date,
                held_total_hours: rows.sum(&:total_hours).abs, action_due_on: Time.current.in_time_zone("Pacific/Guam").to_date,
                source_snapshot: row.snapshot
              )
              settlement_case.payroll_settlement_case_events.create!(
                event_id: SecureRandom.uuid, event_type: "opened", to_status: "open", occurred_at: Time.current,
                metadata: { requires_explicit_routing: true, reason: "Review correction to pre-calendar manually paid hours" }
              )
            end
          rescue ActiveRecord::RecordNotUnique
            # Another reconciler captured this same immutable source version.
            next
          end
        end
    end

    def self.legacy_revision_baselines(rows)
      versions = rows.filter_map do |entry_id, row|
        next if row.snapshot["payable_content_checksum"]

        { entry_id: entry_id, version: row.snapshot.fetch("version", 0).to_i }
      end
      return {} if versions.empty?

      # Prefer the paid source version. Legacy batches can predate revision
      # capture; the earliest retained state then anchors later punch/break
      # changes. Missing break history is unknown, never a known empty list.
      # Approval/signature/timestamp-only touches are not chronology.
      join = ActiveRecord::Base.sanitize_sql_array([
        "INNER JOIN jsonb_to_recordset(?) AS paid(entry_id bigint, version integer) ON paid.entry_id = payroll_time_entry_revisions.source_time_entry_id",
        versions.to_json
      ])
      PayrollTimeEntryRevision.joins(join)
        .where("snapshot ? 'breaks'")
        .select("DISTINCT ON (source_time_entry_id) payroll_time_entry_revisions.*")
        .order(Arel.sql("source_time_entry_id, (source_version <= paid.version) DESC, CASE WHEN source_version <= paid.version THEN source_version END DESC, source_version ASC, id ASC"))
        .index_by(&:source_time_entry_id)
    end
  end
end
