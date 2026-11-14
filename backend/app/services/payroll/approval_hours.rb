# frozen_string_literal: true

module Payroll
  # The approval gate used at lock: approved time sends REG even while OT
  # waits; OT sends only with a valid approval for its current allocation.
  # Denied hours aren't waiting. Chronology holds wait in full. This is live
  # source eligibility, not a replacement for frozen settlement/receipt ledgers.
  class ApprovalHours
    KEYS = %i[approved_regular_hours approved_overtime_hours approved_hours time_waiting_hours overtime_waiting_hours].freeze

    def self.base_approved?(entry)
      entry.status == "completed" &&
        (entry.clock_entry? ? entry.approval_status.in?([ nil, "approved" ]) : entry.approval_status == "approved")
    end

    def self.overtime_reason(entry, allocation, legacy_allocation: nil, cutoff_at: Time.current)
      if !AffectedOvertimeReview.approval_valid?(entry, allocation, legacy_allocation: legacy_allocation) && entry.overtime_status != "denied"
        "pending_overtime"
      elsif entry.overtime_status == "denied"
        "denied_overtime"
      elsif entry.overtime_approved_at.present? && entry.overtime_approved_at > cutoff_at
        "overtime_approved_after_cutoff"
      end
    end

    def self.sum(rows)
      KEYS.index_with { |key| rows.sum { |row| row.fetch(key, 0).to_d }.round(2).to_f }
    end

    def self.for_entries(entries)
      context = AffectedOvertimeReview.context_rows_for(entries)
      new(allocations: AffectedOvertimeReview.allocations(context),
        legacy_allocations: AffectedOvertimeReview.allocations(context, legacy: true))
    end

    def segments_for(entry)
      PayableSegmentView.expand([ entry ], @allocations).map do |segment|
        { work_date: segment.work_date.iso8601, **self.for(segment) }
      end
    end

    def initialize(allocations:, legacy_allocations:)
      @allocations = allocations
      @legacy_allocations = legacy_allocations
    end

    def for(entry)
      source = entry.respond_to?(:payable_allocation) ? entry.__getobj__ : entry
      allocation = @allocations.fetch(entry.id, {})
      part = PayableSegmentView.allocation(entry, @allocations)
      result = KEYS.index_with { 0.0 }
      if allocation[:hold_reason] || (entry.status == "completed" && (entry.approval_status == "pending" || (entry.manual_entry? && entry.approval_status.nil?)))
        result[:time_waiting_hours] = entry.hours.to_f
      elsif self.class.base_approved?(entry)
        reason = self.class.overtime_reason(source, allocation, legacy_allocation: @legacy_allocations[entry.id])
        result[:approved_regular_hours] = part[:regular_hours].to_f
        result[:approved_overtime_hours] = reason ? 0.0 : part[:overtime_hours].to_f
        result[:approved_hours] = (result[:approved_regular_hours].to_d + result[:approved_overtime_hours].to_d).round(2).to_f
        result[:overtime_waiting_hours] = part[:overtime_hours].to_f if reason.in?(%w[pending_overtime overtime_approved_after_cutoff])
      end
      result
    end
  end
end
