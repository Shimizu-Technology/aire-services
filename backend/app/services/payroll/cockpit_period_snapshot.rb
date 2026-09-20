# frozen_string_literal: true

module Payroll
  class CockpitPeriodSnapshot
    PREVIEW_CACHE_TTL = 30.seconds
    Result = Data.define(:readiness, :entry_states, :exception_entry_ids)

    def initialize(period:, entries:)
      @period = period
      @entries = Array(entries).uniq(&:id)
    end

    def call
      rows, exclusions, summary, issues = snapshot_records
      attested_ids = PayrollPaymentAttestation.pending_evidence.where(time_entry_id: entry_ids).pluck(:time_entry_id).to_set
      rows_by_entry = rows.group_by { |row| source_entry_id(row) }
      exclusions_by_entry = exclusions.group_by { |row| source_entry_id(row) }
      missing_category_ids = rows.filter_map do |row|
        source_entry_id(row) if value(row, :source_category_id).nil?
      end.uniq

      entry_states = entries.to_h do |entry|
        entry_rows = rows_by_entry.fetch(entry.id, [])
        entry_exclusions = exclusions_by_entry.fetch(entry.id, [])
        reasons = entry_exclusions.map { |row| value(row, :reason).to_s }.uniq
        included_hours = round_hours(entry_rows.sum { |row| value(row, :total_hours).to_d })
        included = entry_rows.any?

        [
          entry.id,
          {
            payable_now: included && !attested_ids.include?(entry.id),
            payroll_disposition: attested_ids.include?(entry.id) ? "payment_attested_pending_evidence" : disposition(included, reasons, missing_category_ids.include?(entry.id)),
            payroll_exclusion_reasons: reasons,
            included_hours: included_hours
          }
        ]
      end

      Result.new(
        readiness: readiness(summary, issues, rows_by_entry, exclusions),
        entry_states: entry_states,
        exception_entry_ids: (exclusions_by_entry.keys + missing_category_ids + attested_ids.to_a).uniq
      )
    end

    private

    attr_reader :period, :entries

    def snapshot_records
      return persisted_snapshot if period.payroll_batch

      preview = Rails.cache.fetch(preview_cache_key, expires_in: PREVIEW_CACHE_TTL) do
        BatchBuilder.new(
          start_date: period.start_date,
          end_date: period.end_date,
          cutoff_at: period.cutoff_at,
          batch_reference: "COCKPIT-PREVIEW"
        ).call.slice(:rows, :exclusions, :summary, :issues)
      end
      scoped_snapshot(preview.fetch(:rows), preview.fetch(:exclusions), preview.fetch(:summary), preview.fetch(:issues))
    end

    def persisted_snapshot
      batch = period.payroll_batch
      rows = batch.payroll_batch_entries.where(source_time_entry_id: entry_ids).to_a
      exclusions = batch.payroll_batch_exclusions.where(source_time_entry_id: entry_ids).to_a
      row_ids = rows.map(&:source_time_entry_id).to_set
      excluded_ids = exclusions.map(&:source_time_entry_id).to_set
      entries.each do |entry|
        if row_ids.include?(entry.id)
          next if excluded_ids.include?(entry.id) || entry.updated_at <= batch.cutoff_at

          exclusions << synthetic_exclusion(entry, "changed_after_cutoff", 0)
          next
        end
        next if excluded_ids.include?(entry.id) || entry.updated_at <= batch.cutoff_at

        reason = entry.created_at > batch.cutoff_at ? "created_after_cutoff" : "changed_after_cutoff"
        exclusions << synthetic_exclusion(entry, reason, entry.hours)
      end
      [ rows, exclusions, batch.summary, batch.issues ]
    end

    def synthetic_exclusion(entry, reason, held_hours)
      {
        source_time_entry_id: entry.id,
        source_category_id: entry.time_category_id,
        reason: reason,
        held_total_hours: held_hours
      }
    end

    def scoped_snapshot(rows, exclusions, summary, issues)
      ids = entry_ids.to_set
      [
        rows.select { |row| ids.include?(source_entry_id(row)) },
        exclusions.select { |row| ids.include?(source_entry_id(row)) },
        summary,
        issues
      ]
    end

    def preview_cache_key
      [
        "payroll-cockpit-preview-v1",
        period.cache_key_with_version,
        aggregate_version(TimeEntry.where(id: relevant_entry_ids)),
        aggregate_version(TimeEntryBreak.where(time_entry_id: relevant_entry_ids)),
        aggregate_version(TimeCategory.where(id: relevant_category_ids)),
        aggregate_version(User.where(id: relevant_user_ids)),
        aggregate_version(PayrollPaymentAttestation.where(time_entry_id: relevant_entry_ids)),
        latest_batch&.cache_key_with_version,
        relevant_deletion_version
      ]
    end

    def relevant_entry_ids
      @relevant_entry_ids ||= begin
        staff = TimeEntry.joins(:user).merge(User.staff)
        ids = staff.where(work_date: period.start_date..period.end_date).pluck(:id)
        if latest_batch
          ids.concat(
            latest_batch.payroll_batch_exclusions
              .where(reason: PayrollBatchExclusion::CARRYOVER_REASONS)
              .pluck(:source_time_entry_id)
          )
          ids.concat(staff.where("time_entries.work_date < ? AND time_entries.updated_at > ?", period.start_date, latest_batch.cutoff_at).pluck(:id))
          ids.concat(
            staff
              .where(id: PayrollBatchEntry.select(:source_time_entry_id))
              .where("time_entries.updated_at > ?", latest_batch.cutoff_at)
              .pluck(:id)
          )
        end
        ids.uniq
      end
    end

    def relevant_category_ids
      TimeEntry.where(id: relevant_entry_ids).where.not(time_category_id: nil).distinct.pluck(:time_category_id)
    end

    def relevant_user_ids
      TimeEntry.where(id: relevant_entry_ids).where.not(user_id: nil).distinct.pluck(:user_id)
    end

    def latest_batch
      @latest_batch ||= PayrollBatch.order(cutoff_at: :desc, id: :desc).first
    end

    def relevant_deletion_version
      scope = AuditLog.where(action: "time_entry.deleted")
      scope = scope.where("occurred_at > ?", latest_batch.cutoff_at) if latest_batch
      scope.maximum(:id)
    end

    def aggregate_version(model)
      model.pick(
        Arel.sql("COUNT(*)"),
        Arel.sql("MAX(updated_at)"),
        Arel.sql("COALESCE(SUM(id), 0)")
      )
    end

    def entry_ids
      @entry_ids ||= entries.map(&:id)
    end

    def readiness(summary, issues, rows_by_entry, exclusions)
      entry_ids = entries.map(&:id).to_set
      eligible_entry_ids = rows_by_entry.keys.select { |id| entry_ids.include?(id) }
      held_entry_ids = exclusions.map { |row| source_entry_id(row) }.uniq
      {
        total_entries: entries.length,
        total_hours: round_hours(entries.sum { |entry| entry.hours.to_d }),
        eligible_entries: eligible_entry_ids.length,
        eligible_hours: round_hours(value(summary, :total_hours).to_d),
        held_entries: held_entry_ids.length,
        held_hours: round_hours(exclusions.sum { |row| value(row, :held_total_hours).to_d }),
        pending_approvals: entries.count { |entry| entry.approval_status == "pending" },
        denied_entries: entries.count { |entry| entry.approval_status == "denied" },
        missing_punches: entries.count { |entry| entry.status.in?(%w[clocked_in on_break]) || entry.end_time.blank? },
        pending_overtime: entries.count { |entry| entry.overtime_status == "pending" },
        missing_categories: value(issues, :missing_category_count).to_i
      }
    end

    def disposition(included, reasons, missing_category)
      return "missing_category" if missing_category
      return "changed_after_cutoff" if reasons.include?("changed_after_cutoff")
      return "partially_included" if included && reasons.any?
      return "included_at_cutoff" if included

      reasons.first || "not_payable"
    end

    def source_entry_id(row)
      value(row, :source_time_entry_id).to_i
    end

    def value(record, key)
      record.respond_to?(key) ? record.public_send(key) : record[key] || record[key.to_s]
    end

    def round_hours(value)
      BigDecimal(value.to_s).round(2).to_f
    end
  end
end
