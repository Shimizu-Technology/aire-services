# frozen_string_literal: true

module Payroll
  # Authenticated read evidence, outside the immutable batch payload checksum.
  # Reuses the actual prior production algorithm; it never changes payable time.
  class PriorOvertimePolicyEvidence
    KIND = "paid_under_prior_daily_weekly_ot_policy"
    EFFECTIVE_BEFORE = Date.new(2026, 10, 16)
    EFFECTIVE_ON = Date.new(2026, 4, 1)
    POLICY = { "name" => "daily_8_weekly_40", "daily_threshold_hours" => "8.0", "weekly_threshold_hours" => "40.0",
      "workweek_start" => "sunday", "time_zone" => "Pacific/Guam", "allocator_commit" => "6f72a984",
      "effective_from" => "2026-04-01", "effective_before" => "2026-10-16" }.freeze
    Input = Struct.new(:id, :work_date, :hours, :start_time, :created_at, keyword_init: true)

    def initialize(batch:)
      @batch = batch
    end

    def call
      return nil unless @batch.start_date >= EFFECTIVE_ON && @batch.end_date < EFFECTIVE_BEFORE

      @batch_checksum_verified = CanonicalPayload.checksum(@batch.payload) == @batch.checksum
      first = @batch.start_date.beginning_of_week(:sunday)
      owners = @batch.payroll_batch_entries.distinct.pluck(:source_user_id)
      @rows = PayrollBatchEntry.effective.where(source_user_id: owners, work_date: first..@batch.end_date)
        .includes(:payroll_batch).order(:id).to_a
      @entries = TimeEntry.where(id: @rows.map(&:source_time_entry_id)).includes(:user, :time_category, :time_entry_breaks).index_by(&:id)
      @legacy = LegacyFrozenBatchEvidence.new(rows: @rows.select { |row| row.snapshot["payable_content_checksum"].blank? })
      settings = Setting.where(key: %w[overtime_daily_threshold_hours overtime_weekly_threshold_hours]).order(:key).to_a
      audits = AuditLog.where(auditable_type: "Setting", auditable_id: settings.map(&:id)).order(:id).to_a
      @threshold_review_required = audits.any? || settings.any? do |row|
        expected = row.key == "overtime_daily_threshold_hours" ? 8.to_d : 40.to_d
        row.updated_at.to_date <= @batch.start_date && BigDecimal(row.value, exception: false) != expected
      end
      threshold_evidence = {
        "basis" => "owner_reviewed_8_40_fallback_no_versioned_setting_history",
        "decision" => "Leon 2026-11-03: prior daily8/weekly40 before Oct16; weekly-only thereafter",
        "retained_settings" => settings.map { |row| { "key" => row.key, "value" => row.value,
          "created_at" => row.created_at.iso8601(6), "updated_at" => row.updated_at.iso8601(6) } },
        "retained_audit_checksum" => CanonicalPayload.checksum(audits.map(&:attributes)), "retained_audit_count" => audits.length
      }
      proof = { "kind" => KIND, "policy" => POLICY, "threshold_evidence" => threshold_evidence,
        "input_scope" => "all_effective_frozen_current_lines_in_workweek_through_batch_end",
        "source_instance_id" => IntegrationProfile.source_instance_id, "batch_id" => @batch.public_id, "batch_checksum" => @batch.checksum,
        "employees" => owners.map { |owner| employee(owner) } }
      proof.merge("evidence_checksum" => CanonicalPayload.checksum(proof))
    end

    private

    def employee(owner)
      rows = @rows.select { |row| row.source_user_id == owner }
      represented = rows.select { |row| row.payroll_batch_id == @batch.id }
      return { "source_user_id" => owner.to_s, "eligible" => false, "blockers" => [ "unsupported_period_context" ] } if represented.empty?
      blockers = []
      # Settings currently have no versioned history. Do not ignore a retained
      # audit if one is introduced or a historical nonstandard threshold exists.
      blockers << "historical_threshold_audit_requires_review" if @threshold_review_required
      blockers << "immutable_payload_checksum_mismatch" unless @batch_checksum_verified && rows.map(&:payroll_batch).uniq.all? { |batch| CanonicalPayload.checksum(batch.payload) == batch.checksum }
      blockers << "unsupported_context_line" unless rows.all? do |row|
        row.source_kind == "current" && row.work_date >= EFFECTIVE_ON && row.work_date.between?(row.payroll_batch.start_date, row.payroll_batch.end_date)
      end
      inputs = rows.group_by(&:source_time_entry_id).map do |id, source_rows|
        entry = @entries[id]
        snapshot = source_rows.first.snapshot
        exact = entry && source_rows.all? do |row|
          row.source_user_id == entry.user_id && row.total_hours >= 0 &&
            (row.snapshot["payable_content_checksum"].present? ?
              !PayableContent.changed_from_snapshot?(entry, row.snapshot) : @legacy.call(row: row, entry: entry)[:eligible])
        end
        blockers << "frozen_source_changed_or_missing:#{id}" unless exact
        blockers << "partial_or_conflicting_source:#{id}" unless source_rows.sum(&:total_hours) == BigDecimal(snapshot.fetch("hours").to_s) &&
          source_rows.map { |row| row.snapshot }.uniq.one? && source_rows.map(&:payroll_batch_id).uniq.one?
        # The original algorithm sorted on nominal date/time/creation/id, not
        # interval segments. Only unchanged source supplies unretained ordering.
        { "source_time_entry_id" => id.to_s, "version" => entry&.lock_version,
          "source_user_id" => owner.to_s, "source_user_uuid" => entry&.user&.payroll_integration_uuid,
          "payable_content_checksum" => entry && PayableContent.checksum(entry),
          "work_date" => snapshot.fetch("work_date"), "hours" => BigDecimal(snapshot.fetch("hours").to_s).to_s("F"),
          "start_time" => entry&.start_time&.iso8601(6), "created_at" => entry&.created_at&.iso8601(6),
          "frozen_rows" => source_rows.map { |row| { "batch_id" => row.payroll_batch.public_id, "batch_checksum" => row.payroll_batch.checksum,
            "line_key" => row.line_key, "snapshot_checksum" => CanonicalPayload.checksum(row.snapshot) } } }
      end
      allocations = if blockers.empty?
        PriorDailyWeeklyOvertimeAllocator.call(inputs.map do |row|
          Input.new(id: Integer(row.fetch("source_time_entry_id")), work_date: Date.iso8601(row.fetch("work_date")), hours: row.fetch("hours"),
            start_time: row["start_time"] && Time.iso8601(row["start_time"]), created_at: Time.iso8601(row.fetch("created_at")))
        end, daily_threshold: 8.0, weekly_threshold: 40.0)
      else
        {}
      end
      lines = (blockers.empty? ? represented : []).group_by(&:source_time_entry_id).flat_map do |id, source_rows|
        regular = BigDecimal(allocations.dig(id, :regular_hours).to_s.presence || "0")
        source_rows.sort_by { |row| [ row.work_date, row.id ] }.map do |row|
          line_regular = [ regular, row.total_hours ].min
          regular -= line_regular
          { "source_time_entry_id" => id.to_s, "line_key" => row.line_key,
            "regular_hours" => line_regular.to_s("F"), "overtime_hours" => (row.total_hours - line_regular).to_s("F") }
        end
      end
      { "source_user_id" => owner.to_s, "source_user_uuid" => @entries[represented.first.source_time_entry_id]&.user&.payroll_integration_uuid,
        "eligible" => blockers.empty?, "blockers" => blockers.uniq, "inputs" => inputs, "allocations" => lines,
        "inputs_checksum" => CanonicalPayload.checksum(inputs) }
    rescue KeyError, ArgumentError, TypeError => error
      { "source_user_id" => owner.to_s, "eligible" => false, "blockers" => [ "historical_policy_evidence_incomplete:#{error.class.name}" ] }
    end
  end
end
