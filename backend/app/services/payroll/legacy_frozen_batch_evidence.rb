# frozen_string_literal: true

module Payroll
  # Explicitly weaker than a snapshot carrying its original content checksum.
  # Old snapshots retain only some fields. Current source timestamps and every
  # retained post-finalization observation must independently show no edit.
  class LegacyFrozenBatchEvidence
    KIND = "legacy_frozen_batch_baseline"
    STRENGTH = "retained_snapshot_and_unchanged_source"
    REQUIRED_FIELDS = %w[user_id work_date hours time_category].freeze
    SCALAR_FIELDS = %w[user_id work_date hours status entry_method approval_status overtime_status break_minutes time_category_id].freeze
    TIME_FIELDS = %w[start_time end_time clock_in_at clock_out_at approved_at overtime_approved_at].freeze
    RATE_FIELDS = %w[effective_rate_cents_snapshot effective_rate_cents hourly_rate_cents effective_rate hourly_rate].freeze

    def initialize(rows:)
      ids = rows.map(&:source_time_entry_id).uniq
      @revisions = ids.empty? ? {} : PayrollTimeEntryRevision.where(source_time_entry_id: ids).order(:id).group_by(&:source_time_entry_id)
      @audits = ids.empty? ? {} : AuditLog.where(auditable_type: "TimeEntry", auditable_id: ids, outcome: "succeeded").order(:id).group_by(&:auditable_id)
      @checksums = {}
    end

    def call(row:, entry:)
      batch = row.payroll_batch
      snapshot = row.snapshot
      blockers = []
      blockers << "original_checksumming_contract_available" if snapshot["payable_content_checksum"].present?
      blockers << "source_missing" unless entry
      blockers << "retained_snapshot_incomplete" unless REQUIRED_FIELDS.all? { |key| snapshot.key?(key) }
      blockers << "batch_payload_checksum_mismatch" unless checksum_verified?(batch)
      blockers << "batch_finalization_missing" unless batch.finalized_at
      blockers << "batch_finalization_in_future" if batch.finalized_at && batch.finalized_at > Time.current
      return result(blockers) unless entry && batch.finalized_at

      blockers << "source_owner_changed" unless entry.user && entry.user_id == row.source_user_id && snapshot["user_id"].to_s == entry.user_id.to_s
      blockers << "source_timestamp_after_finalization" unless entry.created_at <= batch.finalized_at && entry.updated_at <= batch.finalized_at
      blockers << "snapshot_mismatch" unless snapshot_matches?(snapshot, entry, row)
      blockers << "line_balance_mismatch" unless entry.hours == row.total_hours && row.regular_hours + row.overtime_hours == row.total_hours && row.work_date == entry.work_date
      blockers << "break_changed_after_finalization" if entry.time_entry_breaks.any? { |record| record.created_at > batch.finalized_at || record.updated_at > batch.finalized_at }
      observations = @revisions.fetch(entry.id, []).select { |revision| revision.recorded_at > batch.finalized_at }
      blockers << "revision_shows_later_edit" unless observations.all? { |revision| unchanged_observation?(revision, entry, batch.finalized_at) }
      edits = @audits.fetch(entry.id, []).select do |audit|
        audit.occurred_at > batch.finalized_at && (audit.changes_made.present? || audit.action.match?(/created|updated|deleted|destroyed|corrected|approved|denied|clocked|break_/))
      end
      blockers << "audit_shows_later_edit" if edits.any?
      result(blockers).merge(
        batch_finalized_at: batch.finalized_at.iso8601(6), source_created_at: entry.created_at.iso8601(6),
        source_updated_at: entry.updated_at.iso8601(6), source_version: entry.lock_version,
        source_user_id: entry.user_id.to_s, source_user_uuid: entry.user&.payroll_integration_uuid,
        retained_snapshot_fields: snapshot.keys & (SCALAR_FIELDS + TIME_FIELDS + RATE_FIELDS + %w[time_category breaks regular_hours overtime_hours]),
        unretained_snapshot_fields: (TIME_FIELDS + %w[breaks effective_rate_cents_snapshot]) - snapshot.keys,
        source_observation_checksum: CanonicalPayload.checksum(observation(entry)),
        revision_observation_count: observations.length,
        revision_observation_checksum: CanonicalPayload.checksum(observations.map { |revision| [ revision.id, revision.source_version, revision.recorded_at.iso8601(6), revision.deleted, revision.snapshot.dig("time_entry", "updated_at") ] }),
        later_edit_audit_count: edits.length, payload_checksum_verified: checksum_verified?(batch)
      )
    rescue ArgumentError, TypeError, KeyError
      result([ "legacy_evidence_invalid" ])
    end

    private

    def result(blockers)
      { kind: KIND, evidence_strength: STRENGTH, eligible: blockers.empty?, blockers: blockers.uniq }
    end

    def checksum_verified?(batch)
      @checksums.fetch(batch.id) { @checksums[batch.id] = CanonicalPayload.checksum(batch.payload) == batch.checksum }
    end

    def snapshot_matches?(snapshot, entry, row)
      SCALAR_FIELDS.all? do |key|
        !snapshot.key?(key) || scalar(key, snapshot[key]) == scalar(key, entry.public_send(key))
      end && TIME_FIELDS.all? do |key|
        !snapshot.key?(key) || instant(key, snapshot[key]) == instant(key, entry.public_send(key))
      end && category_matches?(snapshot["time_category"], entry.time_category) &&
        (!snapshot.key?("breaks") || normalized_breaks(snapshot["breaks"]) == normalized_breaks(entry.time_entry_breaks.map(&:attributes))) &&
        %w[regular_hours overtime_hours].all? { |key| !snapshot.key?(key) || BigDecimal(snapshot.fetch(key).to_s) == row.public_send(key) } &&
        rate_matches?(snapshot, entry)
    end

    def category_matches?(frozen, current)
      return current.nil? if frozen.nil?
      return false unless frozen.is_a?(Hash) && frozen.key?("id") && current

      %w[id key name].all? { |key| !frozen.key?(key) || frozen[key].to_s == current.public_send(key).to_s }
    end

    def rate_matches?(snapshot, entry)
      keys = RATE_FIELDS.select { |key| snapshot.key?(key) }
      return entry.effective_rate_cents_snapshot.nil? if keys.empty?

      keys.all? do |key|
        value = snapshot[key]
        next entry.effective_rate_cents_snapshot.nil? if value.nil?
        next false if entry.effective_rate_cents_snapshot.nil?

        amount = BigDecimal(value.to_s)
        amount *= 100 unless key.include?("cents")
        amount == entry.effective_rate_cents_snapshot
      end
    end

    def unchanged_observation?(revision, entry, finalized_at)
      state = revision.time_entry_state
      !revision.deleted && revision.source_version == entry.lock_version && state.updated_at && state.updated_at <= finalized_at &&
        observation(state) == observation(entry) &&
        (state.user&.payroll_integration_uuid.blank? || state.user.payroll_integration_uuid == entry.user.payroll_integration_uuid)
    end

    def observation(entry)
      entry.attributes.slice(*(SCALAR_FIELDS + TIME_FIELDS + %w[time_category_id effective_rate_cents_snapshot])).merge(
        "breaks" => normalized_breaks(entry.time_entry_breaks.map(&:attributes))
      )
    end

    def normalized_breaks(breaks)
      Array(breaks).map do |record|
        { "start_time" => instant("break_start", record.fetch("start_time")),
          "end_time" => instant("break_end", record["end_time"]),
          "duration_minutes" => record["duration_minutes"]&.to_s }
      end
        .sort_by { |record| record["start_time"].to_s }
    end

    def scalar(key, value)
      return nil if value.nil?
      return BigDecimal(value.to_s) if key == "hours"

      value.to_s
    end

    def instant(key, value)
      return nil if value.blank?

      parsed = value.is_a?(Time) ? value : Time.parse(value.to_s)
      key.in?(%w[start_time end_time]) ? parsed.utc.strftime("%H:%M:%S.%6N") : parsed.utc.iso8601(6)
    end
  end
end
