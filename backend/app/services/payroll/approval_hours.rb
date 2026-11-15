# frozen_string_literal: true

module Payroll
  # Shared live source-approval quantities: approved time contributes REG;
  # OT requires a valid approval for its current allocation. Denied time/OT
  # isn't waiting; chronology holds remain on the source date until reviewed.
  # This is not the whole lock gate. BatchBuilder additionally applies legacy
  # allocation review, payment-attestation holds and the replacement-pending
  # skip that preserves already represented wages, plus settlement routing.
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
        legacy_allocations: AffectedOvertimeReview.allocations(context, legacy: true),
        projected_allocations: AffectedOvertimeReview.projected_allocations_for(entries))
    end

    def expand(entries)
      entries.flat_map do |entry|
        if time_waiting?(entry)
          allocated = @projected_allocations.dig(entry.id, :segments)
          next allocated.map { |part| PayableSegmentView.new(entry, part) } if allocated.present? && !@projected_allocations.dig(entry.id, :hold_reason)

          segments = PayableIntervals.segments(entry)
          # Unplaceable breaks/intervals still need review on the source date.
          next [ entry ] if segments.size <= 1 || segments.any? { |segment| segment[:hold_reason] }

          elapsed = 0.to_d
          previous = 0.to_d
          segments.map do |segment|
            elapsed += segment[:seconds]
            cumulative = (elapsed / 3600).round(2)
            part = segment.merge(work_date: segment[:work_date], total_hours: (cumulative - previous).to_f)
            previous = cumulative
            PayableSegmentView.new(entry, part)
          end
        else
          PayableSegmentView.expand([ entry ], @allocations)
        end
      end
    end

    def segments_for(entry)
      expand([ entry ]).map { |segment| { work_date: segment.work_date.iso8601, **self.for(segment) } }
    end

    def initialize(allocations:, legacy_allocations:, projected_allocations: {})
      @projected_allocations = projected_allocations
      @allocations = allocations
      @legacy_allocations = legacy_allocations
    end

    def for(entry)
      source = entry.respond_to?(:payable_allocation) ? entry.__getobj__ : entry
      allocations = time_waiting?(entry) ? @projected_allocations : @allocations
      allocation = allocations.fetch(entry.id, {})
      part = PayableSegmentView.allocation(entry, allocations)
      result = KEYS.index_with { 0.0 }
      if allocation[:hold_reason] || time_waiting?(entry)
        # Pending time waits in full; its overtime is reviewed only after time approval.
        result[:time_waiting_hours] = entry.hours.to_f.round(2)
      elsif self.class.base_approved?(entry)
        reason = self.class.overtime_reason(source, allocation, legacy_allocation: @legacy_allocations[entry.id])
        result[:approved_regular_hours] = part[:regular_hours].to_f
        result[:approved_overtime_hours] = reason ? 0.0 : part[:overtime_hours].to_f
        result[:approved_hours] = (result[:approved_regular_hours].to_d + result[:approved_overtime_hours].to_d).round(2).to_f
        result[:overtime_waiting_hours] = part[:overtime_hours].to_f if reason.in?(%w[pending_overtime overtime_approved_after_cutoff])
      end
      result
    end
    private

    def time_waiting?(entry)
      entry.status == "completed" && (entry.approval_status == "pending" || (entry.manual_entry? && entry.approval_status.nil?))
    end
  end
end
