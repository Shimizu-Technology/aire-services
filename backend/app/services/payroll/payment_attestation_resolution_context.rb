# frozen_string_literal: true

module Payroll
  # The report's entry version does not freeze the other entries which determine
  # weekly overtime. Compare the immutable ledger at reporting and review time.
  class PaymentAttestationResolutionContext
    class Error < StandardError; end

    def initialize(attestation:)
      @attestation = attestation
    end

    def call
      snapshot!.merge(available: true, reason: nil)
    rescue Error, TimeEntryRevisionLedger::CoverageError => e
      { available: false, reason: e.message, regular_hours: nil, overtime_hours: nil,
        total_hours: nil, weekly_context_fingerprint: nil }
    end

    def snapshot!
      raise Error, "Only a pending payment report can be matched" unless attestation.status == "pending_evidence"
      raise Error, "Source changed after this payment report; keep the hold for historical review" if attestation.source_changed?

      captured_at = ApplicationRecord.connection.select_value("SELECT clock_timestamp()")
      if attestation.attested_at > captured_at
        raise Error, "The payment report is ahead of the Source recording clock; keep the hold for historical review"
      end
      original = week_at(attestation.attested_at)
      current = week_at(captured_at)
      original_context = canonical_entries(original)
      current_context = canonical_entries(current)
      unless original_context == current_context
        raise Error, "The source week changed after this payment report; keep the hold for historical classification review"
      end
      held_entry = current.find { |entry| entry.id == attestation.time_entry_id }
      unless held_entry && held_entry.lock_version == attestation.source_time_entry_version &&
          held_entry.user_id == attestation.user_id && held_entry.user.payroll_integration_uuid == attestation.source_user_uuid &&
          held_entry.work_date == attestation.work_date && held_entry.hours.to_d == attestation.hours.to_d
        raise Error, "Revision history does not prove the original reported source hours; keep the hold for review"
      end

      period = PayrollCalendarPeriod.where("start_date <= ? AND end_date >= ?", attestation.work_date, attestation.work_date).order(:id).last
      policy = period ? period.overtime_policy : WeeklyOvertimeAllocator.configured_policy
      unless WeeklyOvertimeAllocator.supported_policy?(policy)
        raise Error, "Published calendar overtime policy requires historical review before matching payment"
      end
      split = WeeklyOvertimeAllocator.call(current).fetch(held_entry.id)
      if split[:hold_reason] || split.fetch(:segments, []).size > 1
        raise Error, "Overnight allocation requires review through its exact scheduled batch lines before matching payment"
      end
      regular = BigDecimal(split.fetch(:regular_hours).to_s).round(2)
      overtime = BigDecimal(split.fetch(:overtime_hours).to_s).round(2)
      if held_entry.overtime_status != "approved" && overtime.positive?
        raise Error, "Approve the complete reported overtime before matching payment"
      end
      unless regular + overtime == attestation.hours.to_d
        raise Error, "The complete reported hours require classification review"
      end

      { regular_hours: regular.to_s("F"), overtime_hours: overtime.to_s("F"),
        total_hours: (regular + overtime).to_s("F"),
        weekly_context_fingerprint: CanonicalPayload.checksum(
          source_instance_id: IntegrationProfile.source_instance_id,
          source_time_entry_id: attestation.time_entry_id.to_s,
          source_time_entry_version: attestation.source_time_entry_version,
          source_user_uuid: attestation.source_user_uuid, work_date: attestation.work_date.iso8601,
          hours: attestation.hours.to_d.to_s("F"), policy: policy, entries: current_context
        ) }
    end

    private

    attr_reader :attestation

    def week_at(cutoff)
      ledger = TimeEntryRevisionLedger.new(cutoff_at: cutoff)
      ledger.require_coverage!
      entries = ledger.entries_for_pairs([ [ attestation.user_id, attestation.work_date.beginning_of_week(:sunday) ] ])
        .select(&:counts_toward_hours?)
      raise Error, "Revision history does not cover this reported source week; keep the hold for review" if entries.empty?

      entries
    end

    def canonical_entries(entries)
      entries.sort_by(&:id).map do |entry|
        { id: entry.id.to_s, version: entry.lock_version, user_id: entry.user_id.to_s,
          user_uuid: entry.user.payroll_integration_uuid, work_date: entry.work_date.iso8601,
          hours: entry.hours.to_d.to_s("F"), category_id: entry.time_category_id&.to_s,
          start_time: entry.start_time&.iso8601(6), created_at: entry.created_at.iso8601(6),
          entry_method: entry.entry_method, status: entry.status,
          approval_status: entry.approval_status, overtime_status: entry.overtime_status }
      end
    end
  end
end
