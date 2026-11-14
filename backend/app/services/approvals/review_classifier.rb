# frozen_string_literal: true

module Approvals
  # One definition of an "ordinary" shift, shared by "Auto-approve ordinary
  # shifts" (at clock-out) and the Approvals inbox (ordinary or needs a look).
  #
  # An ordinary shift is a completed kiosk or mobile clock shift with a work
  # category, no overtime (counting waiting time as if approved), no edits or
  # corrections, not added by hand, not the viewer's or a supervisor's own
  # time, under the auto-approve limit, and not after a lock or across a pay
  # period. A category switch splits one shift into segments; the rules judge
  # the whole shift, so every segment gets the same answer.
  class ReviewClassifier
    ORDINARY = "ordinary"
    NEEDS_LOOK = "needs_look"

    # Audit actions a normal kiosk or mobile shift writes about itself, and the
    # auto-approval's own row. Any other time_entry action means it was edited.
    ORDINARY_SHIFT_AUDIT_ACTIONS = %w[
      time_entry.clocked_in time_entry.clocked_out time_entry.break_started time_entry.break_ended
      time_entry.category_switched time_entry.category_auto_assigned time_entry.auto_approved
    ].freeze
    # A decision that was undone leaves the shift exactly as it was, and an
    # overtime reset is the week's recalculation after another shift's review,
    # so these rows aren't edits either.
    REVIEW_AUDIT_ACTIONS = %w[
      time_entry.approved time_entry.overtime_approved time_entry.approval_undone time_entry.overtime_reset
    ].freeze
    NOT_EDITS = (ORDINARY_SHIFT_AUDIT_ACTIONS + REVIEW_AUDIT_ACTIONS).freeze
    # In-memory shift chaining looks this far around the loaded entries. A
    # chain longer than this spans more than the 23-hour auto-approve cap, so
    # it is "too long" either way.
    SEGMENT_WINDOW = 2.days

    LABELS = {
      overtime: "Overtime",
      own_time: "Your own time",
      supervisor_own_time: "Supervisor's own time",
      needs_another_approver: "Needs another approver",
      added: "Added by hand",
      edited: "Edited",
      clocked_by_supervisor: "Clocked in or out by a supervisor",
      corrected_clock_out: "Corrected clock-out",
      administrator_correction: "Needs administrator correction",
      not_completed: "Shift not finished",
      no_category: "No work category",
      allocation_hold: "Payroll can't place this time yet",
      too_many_segments: "Too many work category switches",
      over_max_hours: "Over %{hours}h",
      after_lock: "After the lock (goes to the next payroll)",
      crosses_period: "Crosses into the next period",
      needs_time_review: "Needs time review",
      overlaps: "Overlaps another shift"
    }.freeze

    # Why a completed clock entry's shift may not be auto-approved. An empty
    # list means it may. Order is stable: the setting, the role, then the rules.
    def self.auto_approve_exceptions(entry, segments)
      exceptions = []
      exceptions << :setting_off unless Setting.auto_approve_ordinary_shifts?
      # Employees only. A supervisor's own time always needs a person.
      exceptions << :not_employee unless entry.user&.employee?
      exceptions + Context.new(segments).rule_exceptions(segments)
    end

    # { entry_id => { review_kind:, exceptions: [{ key:, label: }] } } for the
    # given entries as seen by viewer. Loads shift context in a fixed number of
    # queries, however many entries there are.
    def self.call(entries, viewer:)
      new(entries, viewer: viewer).call
    end

    def self.shift_span_hours(segments)
      (segments.last.clock_out_at - segments.first.clock_in_at) / 1.hour
    end

    def initialize(entries, viewer:)
      @entries = entries.to_a
      @viewer = viewer
    end

    def call
      return {} if @entries.empty?

      segments_by_id = SegmentChains.new(@entries).call
      context = Context.new(segments_by_id.values.flatten)
      max_hours = Setting.auto_approve_max_shift_hours
      @overlapping_ids = TimeEntryOverlap.overlapping_ids(@entries)
      @entries.to_h do |entry|
        exceptions = viewer_exceptions(entry, segments_by_id.fetch(entry.id), context, max_hours)
        [ entry.id, { review_kind: exceptions.empty? ? ORDINARY : NEEDS_LOOK, exceptions: exceptions } ]
      end
    end

    private

    def viewer_exceptions(entry, segments, context, max_hours)
      rules = context.rule_exceptions(segments, max_hours: max_hours)
      found = []
      if entry.user_id == @viewer.id
        found << exception(:own_time)
      elsif !entry.user&.employee?
        found << exception(:supervisor_own_time)
      end
      found << exception(:needs_another_approver) unless @viewer.can_review_time_of?(entry.user_id)
      found << exception(:overtime) if rules.include?(:overtime)

      creator, editor = context.change_actors(segments)
      if entry.manual_entry?
        found << exception(:added, creator ? "Added by #{creator}" : nil)
      elsif rules.include?(:not_completed_clock)
        found << exception(:not_completed)
      end
      found << exception(:edited, editor ? "Edited by #{editor}" : nil) if editor || (rules.include?(:edited) && !entry.manual_entry?)
      found << exception(:clocked_by_supervisor) if rules.include?(:not_self_service) && entry.clock_entry?
      found << exception(:corrected_clock_out) if entry.approval_note.to_s.downcase.include?("corrected clock-out")
      found << exception(:administrator_correction) if entry.needs_administrator_correction?
      found << exception(:no_category) if rules.include?(:no_category)
      found << exception(:allocation_hold) if rules.include?(:allocation_hold)
      found << exception(:too_many_segments) if rules.include?(:too_many_segments)
      found << exception(:over_max_hours, format(LABELS[:over_max_hours], hours: max_hours.to_f.round(2).to_s.delete_suffix(".0"))) if rules.include?(:too_long)
      found << exception(:after_lock) if rules.include?(:late_hours)
      found << exception(:crosses_period) if rules.include?(:crosses_period)
      # Two shifts at once can't both be paid. Never in a batch; a person picks.
      found << exception(:overlaps) if @overlapping_ids.include?(entry.id)
      # Every rule that fired must show up as a reason, or the shift would look
      # ordinary. Waiting time with an unlisted note (an auto-close, say) lands here.
      found << exception(:needs_time_review) if found.empty? && rules.any?
      found.uniq { |row| row[:key] }
    end

    def exception(key, label = nil)
      { key: key.to_s, label: label || LABELS.fetch(key) }
    end

    # Chains each entry into its shift's segments from one query per call,
    # matching TimeClockService.shift_segments (<= SESSION_GAP_SECONDS apart,
    # at most MAX_SHIFT_SEGMENTS).
    class SegmentChains
      def initialize(entries)
        @entries = entries
      end

      def call
        pool = clock_pool
        @entries.to_h do |entry|
          next [ entry.id, [ entry ] ] unless entry.clock_entry? && entry.clock_in_at

          [ entry.id, chain(entry, pool.fetch(entry.user_id, [])) ]
        end
      end

      private

      def clock_pool
        clocks = @entries.select { |entry| entry.clock_entry? && entry.clock_in_at }
        return {} if clocks.empty?

        first = clocks.map(&:clock_in_at).min - SEGMENT_WINDOW
        last = clocks.map { |entry| entry.clock_out_at || entry.clock_in_at }.max + SEGMENT_WINDOW
        loaded = @entries.index_by(&:id)
        TimeEntry.clock_entries.where(user_id: clocks.map(&:user_id).uniq, clock_in_at: first..last)
          .includes(:user, :time_entry_breaks).to_a
          .map { |row| loaded.fetch(row.id, row) }
          .group_by(&:user_id)
      end

      def chain(entry, rows)
        cap = TimeClockService::MAX_SHIFT_SEGMENTS
        segments = [ entry ]
        while segments.size < cap && (previous = adjacent(segments.first, segments, rows, :previous))
          segments.unshift(previous)
        end
        while segments.size < cap && (following = adjacent(segments.last, segments, rows, :following))
          segments.push(following)
        end
        segments
      end

      def adjacent(segment, seen, rows, direction)
        gap = TimeClockService::SESSION_GAP_SECONDS.seconds
        candidates = rows.reject { |row| seen.any? { |item| item.id == row.id } }
        if direction == :previous
          return unless segment.clock_in_at

          candidates.select { |row| row.clock_out_at&.between?(segment.clock_in_at - gap, segment.clock_in_at) }.max_by(&:clock_out_at)
        else
          return unless segment.clock_out_at

          candidates.select { |row| row.clock_in_at&.between?(segment.clock_out_at, segment.clock_out_at + gap) }.min_by(&:clock_in_at)
        end
      end
    end

    # Everything the rules need about a set of shift segments, loaded once.
    class Context
      def initialize(segments)
        @segments = segments.uniq(&:id)
        return if @segments.empty?

        ids = @segments.map(&:id)
        @allocations = Payroll::AffectedOvertimeReview.projected_allocations_for(@segments)
        @audit_rows = AuditLog.where(auditable_type: "TimeEntry", auditable_id: ids)
          .where("action LIKE 'time_entry.%'")
          .order(:occurred_at, :id)
          .pluck(:auditable_id, :action, :actor_name)
          .group_by(&:first)
        dates = @segments.map(&:work_date).compact
        @batch_ranges = dates.empty? ? [] : PayrollBatch.where("start_date <= ? AND end_date >= ?", dates.max, dates.min).pluck(:start_date, :end_date)
        @cutoff_warning_ids = Payroll::EntryCutoffWarnings.call(@segments)
        @cutoffs = load_cutoffs
      end

      # TimeClockService's ordinary-shift rules, minus the setting and role.
      def rule_exceptions(segments, max_hours: Setting.auto_approve_max_shift_hours)
        exceptions = []
        exceptions << :not_completed_clock unless segments.all? { |segment| completed_clock?(segment) }
        # A supervisor starting, switching or ending any part of the shift.
        exceptions << :not_self_service unless segments.all? { |segment| segment.clock_source.in?(TimeClockService::SELF_SERVICE_CLOCK_SOURCES) && !segment.admin_override? }
        exceptions << :no_category if segments.any? { |segment| segment.time_category_id.blank? }
        # Scheduled shifts are not queued and keep today's behaviour. A queued
        # shift whose only reason is the missing schedule qualifies; corrected
        # clock-outs, edits, auto-closes and 24-hour holds add their own note.
        exceptions << :queued_for_another_reason unless segments.all? { |segment| segment.approval_status == "pending" && segment.approval_note == TimeClockService::UNSCHEDULED_NOTE }
        exceptions << :edited if edit_rows(segments).any?
        exceptions << :overtime if overtime_portion?(segments)
        # Payroll cannot place the time yet (for example an overnight break that
        # does not line up). Batches hold it as pending, so a person must look.
        exceptions << :allocation_hold if segments.any? { |segment| @allocations.dig(segment.id, :hold_reason) }
        # Past the segment cap the chain is cut short, so the rules can't see the
        # whole shift; leave all of it for a person.
        exceptions << :too_many_segments if truncated?(segments)
        exceptions << :too_long if exceptions.exclude?(:not_completed_clock) && ReviewClassifier.shift_span_hours(segments) >= max_hours
        exceptions << :late_hours if segments.any? { |segment| late_hours?(segment) }
        exceptions << :crosses_period if exceptions.exclude?(:not_completed_clock) && crosses_period_or_cutoff?(segments)
        exceptions
      end

      # [who added the time by hand, who last edited it], from the audit trail.
      def change_actors(segments)
        rows = segments.flat_map { |segment| @audit_rows.fetch(segment.id, []) }
        creator = rows.find { |_id, action, _name| action == "time_entry.created" }&.last
        editor = edit_rows(segments).reject { |_id, action, _name| action == "time_entry.created" }.last&.last
        [ creator.presence, editor.presence ]
      end

      private

      def edit_rows(segments)
        segments.flat_map { |segment| @audit_rows.fetch(segment.id, []) }.reject { |_id, action, _name| NOT_EDITS.include?(action) }
      end

      def completed_clock?(entry)
        entry.clock_entry? && entry.status == "completed" && entry.clock_in_at.present? && entry.clock_out_at.present?
      end

      # Overtime is never auto-approved. Count time still waiting for approval
      # as if approved, so a shift that would push the week over 40 hours once
      # earlier shifts (or its own earlier segments) are approved is queued too.
      def overtime_portion?(segments)
        segments.any? do |segment|
          !segment.overtime_status.in?([ nil, "none" ]) || @allocations.dig(segment.id, :overtime_hours).to_f.positive?
        end
      end

      def truncated?(segments)
        return false if segments.size < TimeClockService::MAX_SHIFT_SEGMENTS

        # Rare enough to ask the database directly, exactly as the clock does.
        TimeClockService.shift_segments_truncated?(segments)
      end

      # Late hours: the work date is in a pay period AIRE already finalized, or
      # one whose published lock has passed.
      def late_hours?(entry)
        date = entry.work_date
        @batch_ranges.any? { |starts_on, ends_on| date.between?(starts_on, ends_on) } || @cutoff_warning_ids.include?(entry.id)
      end

      # Clocked in and out in different pay periods (1st–15th, 16th–month end),
      # or a payroll lock fell inside the shift.
      def crosses_period_or_cutoff?(segments)
        clock_out_date = segments.last.clock_out_at.in_time_zone(TimeClockService::BUSINESS_TIMEZONE).to_date
        return true if pay_period_key(segments.first.work_date) != pay_period_key(clock_out_date)

        shift = segments.first.clock_in_at..segments.last.clock_out_at
        @cutoffs.any? { |cutoff| shift.cover?(cutoff) }
      end

      def pay_period_key(date)
        [ date.year, date.month, date.day <= 15 ? 1 : 2 ]
      end

      def load_cutoffs
        clocks = @segments.select { |segment| segment.clock_in_at && segment.clock_out_at }
        return [] if clocks.empty?

        range = clocks.map(&:clock_in_at).min..clocks.map(&:clock_out_at).max
        PayrollCalendarPeriod.where(cutoff_at: range).pluck(:cutoff_at) + PayrollBatch.where(cutoff_at: range).pluck(:cutoff_at)
      end
    end
  end
end
