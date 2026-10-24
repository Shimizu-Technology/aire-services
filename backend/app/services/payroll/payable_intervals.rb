# frozen_string_literal: true

module Payroll
  # Dates here are payable dimensions. The source's nominal work_date is never
  # changed. Keep seconds (including fractional seconds) until final allocation.
  class PayableIntervals
    ZONE = ActiveSupport::TimeZone["Pacific/Guam"]

    def self.bounds(entry)
      start = entry.start_time&.in_time_zone(ZONE)
      return unless start && entry.respond_to?(:end_time) && entry.end_time

      finish = entry.end_time.in_time_zone(ZONE)
      from = ZONE.local(entry.work_date.year, entry.work_date.month, entry.work_date.day) + start.seconds_since_midnight
      to = from.beginning_of_day + finish.seconds_since_midnight
      to += 1.day if to <= from
      [ from, to ]
    end

    def self.overlaps?(entry, range)
      interval = bounds(entry)
      return range.cover?(entry.work_date) unless interval

      interval.first.to_date <= range.end && (interval.last - 0.000001).to_date >= range.begin
    end

    def self.segments(entry)
      interval = bounds(entry)
      return [ scalar(entry) ] unless interval

      from, to = interval
      if from.to_date == (to - 0.000001).to_date
        return [ scalar(entry) ]
      end

      # Revision states explicitly mark missing historical break chronology.
      if entry.respond_to?(:payroll_break_chronology) && entry.payroll_break_chronology == false
        return [ scalar(entry).merge(hold_reason: "missing_break_chronology") ]
      end
      breaks = entry.time_entry_breaks.to_a.sort_by(&:start_time)
      invalid = breaks.any? { |b| !b.end_time || b.start_time < from || b.end_time > to || b.end_time <= b.start_time } ||
        breaks.each_cons(2).any? { |a, b| a.end_time && a.end_time > b.start_time }
      observed_minutes = breaks.sum { |b| b.duration_minutes.to_i }
      if invalid || observed_minutes != entry.break_minutes.to_i
        return [ scalar(entry).merge(hold_reason: "unplaced_overnight_break") ]
      end

      result = []
      cursor = from
      while cursor < to
        finish = [ cursor.tomorrow.beginning_of_day, to ].min
        seconds = (finish.to_r - cursor.to_r).to_d
        breaks.each do |brk|
          overlap = [ [ finish.to_r, brk.end_time.to_r ].min - [ cursor.to_r, brk.start_time.to_r ].max, 0 ].max
          seconds -= overlap.to_d
        end
        result << { work_date: cursor.to_date, week_start: cursor.to_date.beginning_of_week(:sunday),
                    start_at: cursor, seconds: seconds, entry: entry }
        cursor = finish
      end
      if (result.sum { |s| s[:seconds] } / 3600).round(2) != entry.hours.to_d.round(2)
        # Rounded break-minute storage can differ from exact chronology by a
        # minute. Reconcile only that documented rounding envelope.
        difference = (result.sum { |s| s[:seconds] } / 3600 - entry.hours.to_d).abs
        return [ scalar(entry).merge(hold_reason: "interval_total_requires_review") ] if difference > (breaks.size + 1).to_d / 120
      end
      # Weekly capacity uses the paid-hours unit. Preserve exact interval
      # proportions, scaling their seconds before applying the weekly cap.
      exact_total = result.sum { |segment| segment[:seconds] }
      paid_seconds = entry.hours.to_d.round(2) * 3600
      normalized = 0.to_d
      result.each_with_index do |segment, index|
        segment[:seconds] = if index == result.size - 1
          paid_seconds - normalized
        elsif exact_total.zero?
          0.to_d
        else
          paid_seconds * segment[:seconds] / exact_total
        end
        normalized += segment[:seconds]
      end
      result
    end

    def self.scalar(entry)
      { work_date: entry.work_date, week_start: entry.work_date.beginning_of_week(:sunday),
        start_at: bounds(entry)&.first, seconds: entry.hours.to_d * 3600, entry: entry }
    end

    def self.allocate(entries)
      rows = entries.flat_map { |entry| segments(entry) }
      held_weeks = rows.select { |s| s[:hold_reason] }.flat_map { |s| WeeklyOvertimeAllocator.weeks(s[:entry]) }.uniq
      rows.each do |segment|
        segment[:hold_reason] ||= "unresolved_week_interval" if held_weeks.include?(segment[:week_start])
      end
      rows.group_by { |s| s[:week_start] }.each_value do |week|
        cumulative = 0.to_d
        daily = Hash.new(0.to_d)
        week.sort_by { |s| [ s[:work_date], s[:start_at]&.seconds_since_midnight || 0, s[:entry].created_at, s[:entry].id ] }.each do |segment|
          seconds = segment[:seconds]
          regular = [ seconds, [ 40.to_d * 3600 - cumulative, 0.to_d ].max ].min
          segment[:regular_seconds] = regular
          segment[:overtime_seconds] = seconds - regular
          segment[:daily_cumulative_before] = (daily[segment[:work_date]] / 3600).round(2).to_f
          segment[:weekly_cumulative_before] = (cumulative / 3600).round(2).to_f
          daily[segment[:work_date]] += seconds
          cumulative += seconds
          segment[:daily_cumulative_after] = (daily[segment[:work_date]] / 3600).round(2).to_f
          segment[:weekly_cumulative_after] = (cumulative / 3600).round(2).to_f
        end
      end
      rows.group_by { |s| s[:entry].id }.transform_values do |segments|
        entry = segments.first[:entry]
        # Cumulative rounding conserves the approved entry total exactly. The
        # last component absorbs its sub-cent residual, never a second break.
        exact_total = segments.sum { |s| s[:seconds] }
        elapsed = 0.to_d
        rounded_total = 0.to_d
        segments.each_with_index do |segment, index|
          elapsed += segment[:seconds]
          cumulative_total = if index == segments.size - 1 || exact_total.zero?
            entry.hours.to_d.round(2)
          else
            (entry.hours.to_d * elapsed / exact_total).round(2)
          end
          total = cumulative_total - rounded_total
          regular = [ (segment[:regular_seconds] / 3600).round(2), total ].min
          regular = total if segment[:overtime_seconds].zero?
          segment[:regular_hours] = regular.to_f
          segment[:overtime_hours] = (total - regular).to_f
          segment[:total_hours] = total.to_f
          rounded_total = cumulative_total
        end
        public_segments = segments.map { |s| s.except(:entry, :seconds, :regular_seconds, :overtime_seconds, :start_at) }
        { regular_hours: public_segments.sum { |s| s[:regular_hours].to_d }.to_f,
          overtime_hours: public_segments.sum { |s| s[:overtime_hours].to_d }.to_f,
          segments: public_segments, hold_reason: segments.filter_map { |s| s[:hold_reason] }.first,
          **public_segments.last.slice(:daily_cumulative_before, :daily_cumulative_after, :weekly_cumulative_before, :weekly_cumulative_after) }
      end
    end
  end
end
