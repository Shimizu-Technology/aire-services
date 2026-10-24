# frozen_string_literal: true

require "delegate"

module Payroll
  # A read-only report view; IDs and nominal source records remain untouched.
  class PayableSegmentView < SimpleDelegator
    attr_reader :payable_allocation

    def initialize(entry, allocation)
      super(entry)
      @payable_allocation = allocation
    end

    def work_date
      payable_allocation.fetch(:work_date)
    end

    def hours
      payable_allocation.fetch(:total_hours).to_d
    end

    def start_time
      [ PayableIntervals.bounds(__getobj__).first, day_start ].max
    end

    def end_time
      [ PayableIntervals.bounds(__getobj__).last, day_start + 1.day ].min
    end

    def formatted_start_time
      start_time.strftime("%-I:%M %p")
    end

    def formatted_end_time
      end_time.strftime("%-I:%M %p")
    end

    def day_start
      PayableIntervals::ZONE.local(work_date.year, work_date.month, work_date.day)
    end

    def time_entry_breaks
      __getobj__.time_entry_breaks.filter_map do |brk|
        next unless brk.end_time

        from = [ day_start, brk.start_time ].max
        to = [ day_start + 1.day, brk.end_time ].min
        next unless to > from

        TimeEntryBreak.instantiate(brk.attributes.merge("start_time" => from, "end_time" => to,
          "duration_minutes" => ((to - from) / 60.0).round))
      end
    end

    def break_minutes
      from = PayableIntervals::ZONE.local(work_date.year, work_date.month, work_date.day)
      to = from + 1.day
      time_entry_breaks.sum do |brk|
        next 0 unless brk.end_time

        [ [ to, brk.end_time ].min - [ from, brk.start_time ].max, 0 ].max / 60.0
      end
    end

    def self.expand(entries, allocations)
      entries.flat_map do |entry|
        segments = allocations.dig(entry.id, :segments)
        segments && segments.size > 1 ? segments.map { |s| new(entry, s) } : [ entry ]
      end
    end

    def self.allocation(entry, allocations)
      entry.respond_to?(:payable_allocation) ? entry.payable_allocation : allocations.fetch(entry.id, {})
    end
  end
end
