# frozen_string_literal: true

module Payroll
  # Frozen work is counted once. Independent frozen lines retain independent
  # owner chains even when a reader asks for aggregate metadata.
  class ObligationOwnerResolver
    def self.current_events(events)
      grouped = Array(events).group_by { |event| [ event.payroll_batch_id, event.source_time_entry_id, event.source_line_key ] }
      corrected_entries = grouped.filter_map do |key, candidates|
        key.first(2) if candidates.any?(&:payroll_obligation_correction_id)
      end.to_set
      grouped.flat_map do |key, candidates|
        next [] if key.last.blank? && corrected_entries.include?(key.first(2))

        corrections = candidates.filter_map(&:payroll_obligation_correction).uniq(&:id)
        next candidates if corrections.empty?

        owner = corrections.max_by(&:id)
        candidates.select do |event|
          event.external_system == owner.external_system &&
            event.external_pay_period_id == owner.successor_pay_period_id &&
            event.external_payroll_item_id == owner.successor_payroll_item_id
        end
      end
    end
  end
end
