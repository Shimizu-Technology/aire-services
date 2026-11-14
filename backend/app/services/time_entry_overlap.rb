# frozen_string_literal: true

# One person can't work two shifts at once. Added time and edits that would
# overlap another of the person's shifts that still counts (anything not
# denied) are refused with a message naming that shift. Clocking in and out is
# unchanged. An open clock overlaps everything after its start.
#
# Call it with the employee's rows locked (Payroll::AffectedOvertimeReview.lock
# or TimeEntry#lock!) so two saves for the same person can't both pass.
class TimeEntryOverlap
  ACTIVE_STATUSES = %w[clocked_in on_break].freeze
  TIME_INPUTS = %w[work_date start_time end_time clock_in_at clock_out_at status].freeze

  def self.error_for(entry, actor:)
    return unless check?(entry)

    other = conflict_for(entry)
    other && message(other, actor: actor)
  end

  # New rows, changed times, and a denied shift coming back for review.
  def self.check?(entry)
    entry.new_record? || (entry.changes.keys & TIME_INPUTS).any? ||
      (entry.approval_status_changed? && entry.approval_status_was == "denied")
  end

  def self.conflict_for(entry)
    return if entry.approval_status == "denied"

    span = interval(entry)
    return unless span

    candidates(entry)
      .filter_map { |other| (other_span = interval(other)) && [ other, other_span ] }
      .select { |_other, other_span| overlaps?(span, other_span) }
      .min_by { |other, other_span| [ other_span.first, other.id ] }
      &.first
  end

  # [start, end) in Guam. Shift times are times of day on the work date; an end
  # before the start is the next morning, and an end equal to the start is a
  # zero-length shift (a mis-tap), never 24 hours. An open clock has no end.
  def self.interval(entry)
    return unless entry.work_date && entry.start_time

    starts = on_day(entry.work_date, entry.start_time)
    return [ entry.clock_in_at || starts, nil ] if entry.status.in?(ACTIVE_STATUSES)
    return unless entry.end_time

    ends = on_day(entry.work_date, entry.end_time)
    ends += 1.day if ends < starts
    [ starts, ends ]
  end

  def self.overlaps?(left, right)
    (right.last.nil? || left.first < right.last) && (left.last.nil? || right.first < left.last)
  end

  def self.message(other, actor:)
    whose = other.user_id == actor.id ? "your" : "#{other.user.full_name}'s"
    day = other.work_date.strftime("%a, %b %-d")
    day += ", #{other.work_date.year}" unless other.work_date.year == BusinessDate.today.year
    shift = if other.status.in?(ACTIVE_STATUSES)
      "#{whose} shift on #{day} that started at #{other.formatted_start_time} and is still on the clock"
    else
      "#{whose} #{other.formatted_start_time}–#{other.formatted_end_time} shift on #{day}"
    end
    "This overlaps #{shift}. Change the times or pick another day."
  end

  # Ids of the given entries that overlap another counted shift of the same
  # person, from one query however many entries there are.
  def self.overlapping_ids(entries)
    entries = entries.reject { |entry| entry.approval_status == "denied" || entry.work_date.nil? }
    return Set.new if entries.empty?

    first = entries.map(&:work_date).min - 2
    last = entries.any? { |entry| entry.status.in?(ACTIVE_STATUSES) } ? nil : entries.map(&:work_date).max + 1
    scope = TimeEntry.where(user_id: entries.map(&:user_id).uniq).where("approval_status IS NULL OR approval_status <> ?", "denied")
    others = scope.where(work_date: first..last).or(scope.where(status: ACTIVE_STATUSES)).to_a.group_by(&:user_id)
    entries.each_with_object(Set.new) do |entry, ids|
      span = interval(entry)
      next unless span

      clash = others.fetch(entry.user_id, []).any? do |other|
        other.id != entry.id && (other_span = interval(other)) && overlaps?(span, other_span)
      end
      ids << entry.id if clash
    end
  end

  def self.candidates(entry)
    scope = TimeEntry.where(user_id: entry.user_id).where("approval_status IS NULL OR approval_status <> ?", "denied")
    scope = scope.where.not(id: entry.id) if entry.persisted?
    # An open clock reaches forward without limit; anything else spans under
    # a day, so only nearby work dates and other open clocks can touch it.
    return scope.where(work_date: (entry.work_date - 1)..) if entry.status.in?(ACTIVE_STATUSES)

    scope.where(work_date: (entry.work_date - 2)..(entry.work_date + 1)).or(scope.where(status: ACTIVE_STATUSES))
  end

  def self.on_day(date, time)
    zone = ActiveSupport::TimeZone[TimeClockService::BUSINESS_TIMEZONE]
    local = time.in_time_zone(zone)
    # Keep fractional seconds: sub-second clock punches must keep their order.
    zone.local(date.year, date.month, date.day, local.hour, local.min, local.sec + local.subsec)
  end
  private_class_method :candidates, :on_day
end
