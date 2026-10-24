# frozen_string_literal: true

module Payroll
  # Derived receipt evidence only: never closes a case or changes frozen work.
  class SettlementCaseCompletion
    def initialize(settlement_case:, entry:, allocation: nil, held: false)
      @settlement_case = settlement_case
      @entry = entry
      @allocation = allocation
      @held = held
    end

    def call
      batch = settlement_case.included_payroll_batch
      return unless settlement_case.status == "in_payroll" && batch && entry && entry.counts_toward_hours? && !held &&
        user.payroll_integration_uuid.present? && settlement_case.source_time_entry_id == entry.id &&
        settlement_case.source_user_id == user.id && settlement_case.source_user_uuid == user.payroll_integration_uuid &&
        entry.work_date == settlement_case.original_work_date

      return supplemental_completion(batch) if batch.payload["purpose"] == "supplemental"

      rows = matching_rows(batch)
      return unless rows.one?
      row = rows.first
      version = row.snapshot.is_a?(Hash) && row.snapshot["version"]
      return unless version.is_a?(Integer) && version >= 0 && version == entry.lock_version && version >= settlement_case.source_time_entry_version
      event = exact_event(batch, row)
      return unless event

      if row.source_kind == "correction" && row.total_hours.positive?
        "paid" if positive_correction_confirmed?(row, event)
      elsif settlement_case.origin_reason.in?(%w[changed_after_cutoff deleted_after_cutoff])
        accounting = AccountingCorrectionReceipt.context(row: row, event: event)
        "accounting_recorded" if version == settlement_case.source_time_entry_version && accounting && original_payment_confirmed?(accounting)
      elsif row.source_kind == "carryover"
        "paid" if issued?(row, event) && row.total_hours == entry.hours.to_d &&
          row.source_category_id.present? && row.source_category_id == entry.time_category_id
      end
    end

    private

    attr_reader :settlement_case, :entry, :held

    def supplemental_completion(batch)
      rows = batch.payroll_batch_entries.select { |row| row.source_time_entry_id == entry.id }
      split = allocation
      return unless rows.any? && split && !split[:hold_reason] &&
        rows.sum(&:total_hours) == entry.hours.to_d && rows.sum(&:regular_hours) == split[:regular_hours].to_d &&
        rows.sum(&:overtime_hours) == split[:overtime_hours].to_d &&
        (!split[:overtime_hours].to_d.positive? || entry.overtime_status.in?(%w[approved none]))
      dates = PayableIntervals.segments(entry).select { |segment| segment[:seconds].positive? }.map { |segment| segment[:work_date] }.sort
      return unless rows.map(&:work_date).sort == dates
      return unless settlement_case.target_external_pay_period_id == batch.payload["target_external_pay_period_id"]
      return unless rows.all? do |row|
        version = row.snapshot["version"]
        event = exact_event(batch, row)
        row.source_kind == "carryover" && row.source_user_id == entry.user_id && row.source_user_uuid == user.payroll_integration_uuid &&
          row.source_category_id.present? && row.source_category_id == supplemental_category_id(row) &&
          version.is_a?(Integer) && version == entry.lock_version && version >= settlement_case.source_time_entry_version &&
          row.regular_hours >= 0 && row.overtime_hours >= 0 && row.total_hours == row.regular_hours + row.overtime_hours &&
          issued?(row, event) && supplemental_owner_matches?(row, event, batch)
      end

      "paid"
    end

    def supplemental_owner_matches?(row, event, batch)
      owner = PayrollObligationCorrection.where(payroll_batch_entry: row).order(:id).last
      return event.external_pay_period_id == batch.payload["target_external_pay_period_id"] unless owner

      event.payroll_obligation_correction_id == owner.id && event.external_system == owner.external_system &&
        event.external_pay_period_id == owner.successor_pay_period_id && event.external_payroll_item_id == owner.successor_payroll_item_id
    end

    def supplemental_category_id(row)
      return entry.time_category_id if entry.time_category_id.present?
      return unless row.snapshot["time_category_inferred_from_sole_assignment"]

      assigned = user.assigned_time_categories.where(is_active: true).pluck(:id)
      assigned.first if assigned.one?
    end

    def user
      entry.user
    end

    def matching_rows(batch)
      rows = batch.payroll_batch_entries.select { |row| row.source_time_entry_id == entry.id }
      return [] unless rows.one?

      rows.select do |row|
        row.source_user_id == user.id && row.source_user_uuid == user.payroll_integration_uuid &&
          row.work_date == settlement_case.original_work_date
      end
    end

    def exact_event(batch, row)
      candidates = batch.payroll_entry_processing_events.select do |event|
        event.source_time_entry_id == entry.id && (event.source_line_key.blank? || event.source_line_key == row.line_key)
      end
      event = PayrollEntryProcessingEvent.latest(candidates)
      return unless event&.line_contract? && event.source_user_uuid == row.source_user_uuid &&
        event.source_line_key == row.line_key && event.source_kind == row.source_kind && event.external_system == "cornerstone_payroll" &&
        event.external_pay_period_id.present? && event.external_payroll_item_id.present? &&
        %i[total_hours regular_hours overtime_hours].all? { |field| event.public_send(field) == row.public_send(field) }

      event
    end

    def issued?(row, event)
      row.total_hours.finite? && row.total_hours.positive? && event&.status == "payment_issued" &&
        event.payment_method.in?(%w[paper_check direct_deposit]) && event.payment_reference.present?
    end

    def original_payment_confirmed?(accounting)
      batch = settlement_case.origin_payroll_batch
      rows = matching_rows(batch)
      return false unless rows.one?
      row = rows.first
      return false unless row.source_kind.in?(%w[current carryover])

      # Cancellation tombstones remain effective; an old issuance cannot
      # restore the original instrument. A fresh exact replacement may.
      event = exact_event(batch, row)
      issued?(row, event) && event.external_pay_period_id == accounting["original_pay_period_id"] &&
        event.external_payroll_item_id == accounting["original_payroll_item_id"]
    end

    def positive_correction_confirmed?(delta, event)
      return false unless issued?(delta, event)
      originals = matching_rows(settlement_case.origin_payroll_batch)
      return false unless originals.one?
      original = originals.first
      original_version = original.snapshot.is_a?(Hash) && original.snapshot["version"]
      return false unless original.source_kind.in?(%w[current carryover]) && original_version.is_a?(Integer) && original_version >= 0 &&
        original_version <= settlement_case.source_time_entry_version && original_version < entry.lock_version &&
        issued?(original, exact_event(settlement_case.origin_payroll_batch, original))
      return false unless entry.time_category_id.present? && [ original, delta ].all? do |row|
        row.source_category_id == entry.time_category_id && row.regular_hours.finite? && row.overtime_hours.finite? &&
          row.regular_hours >= 0 && row.overtime_hours >= 0 && row.total_hours == row.regular_hours + row.overtime_hours
      end

      split = allocation
      return false unless split && (!split[:overtime_hours].to_d.positive? || entry.overtime_status.in?(%w[approved none]))

      original.total_hours + delta.total_hours == entry.hours.to_d &&
        original.regular_hours + delta.regular_hours == split[:regular_hours].to_d &&
        original.overtime_hours + delta.overtime_hours == split[:overtime_hours].to_d
    end

    def allocation
      @allocation ||= WeeklyOvertimeAllocator.call(
        TimeEntry.where(user_id: entry.user_id, work_date: (entry.work_date.beginning_of_week(:sunday) - 1)..(entry.work_date.end_of_week(:sunday) + 7)).order(:work_date, :id).select(&:counts_toward_hours?)
      )[entry.id]
    end
  end
end
