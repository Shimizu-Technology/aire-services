# frozen_string_literal: true

# Everything on Today's "Needs attention" list in one request, scoped to what
# the viewer may act on. Items come in a fixed order: payroll-blocking clocks
# first, then approvals, payroll problems, and people's requests.
class AttentionQuery
  OPEN_STATUSES = WhosWorkingQuery::OPEN_STATUSES
  LONG_CLOCK_HOURS = 12
  MISSING_CATEGORY_SAMPLE = 20
  PROJECTED_OVERTIME_LIMIT = 100

  # The Approvals inbox and its badge: anything with time or overtime waiting.
  # Keep in step with TimeEntriesController#pending_approval_entries_scope;
  # spec/requests/api/v1/attention_spec.rb fails if the counts drift apart.
  def self.waiting_scope
    TimeEntry.where("time_entries.approval_status = ? OR time_entries.overtime_status = ?", "pending", "pending")
  end

  def self.call(viewer:, now: Time.current)
    new(viewer: viewer, now: now).call
  end

  def initialize(viewer:, now: Time.current)
    @viewer = viewer
    @now = now
    @today = now.in_time_zone(TimeClockService::BUSINESS_TIMEZONE).to_date
  end

  def call
    approvals = approvals_summary
    period = Payroll::PeriodHandoffState.current_period_summary(today: today, now: now)
    items = [
      *open_clock_items,
      approvals_item(approvals),
      overtime_item,
      missing_category_item(period),
      *payroll_problem_items,
      leave_item,
      *kiosk_pin_items,
      pay_stub_item
    ].compact

    {
      generated_at: now.in_time_zone(TimeClockService::BUSINESS_TIMEZONE).iso8601,
      time_zone: TimeClockService::BUSINESS_TIMEZONE,
      today: today.iso8601,
      sections: sections,
      count: items.size,
      items: items,
      approvals: approvals,
      period: period,
      connected_payroll: ConnectedPayrollMode.capability
    }
  end

  private

  attr_reader :viewer, :now, :today

  def sections
    {
      team_time: viewer.can_manage_team_time?,
      approvals: viewer.can_approve_time?,
      payroll: viewer.can_manage_payroll?,
      leave: viewer.can_approve_leave?,
      kiosk_pins: viewer.can_unlock_kiosk?,
      pay_stub_requests: viewer.can_send_pay_statements?
    }
  end

  # Earlier-day clocks use the Guam work date, like Who's working, so a shift
  # started before midnight is flagged the moment the day changes.
  def open_clock_items
    return [] unless viewer.can_manage_team_time?

    entries = TimeEntry.clock_entries.where(status: OPEN_STATUSES, work_date: ..today)
      .joins(:user).merge(User.staff)
      .preload(:user, :time_entry_breaks, :time_category)
      .order(:clock_in_at, :id).to_a
    earlier, current = entries.partition { |entry| entry.work_date < today }
    long = current.map { |entry| [ entry, elapsed_hours(entry) ] }.select { |_, hours| hours > LONG_CLOCK_HOURS }

    earlier.map { |entry| clock_item("open_clock_earlier_day", "needs_fix", entry, elapsed_hours(entry)) } +
      long.sort_by { |entry, hours| [ -hours, entry.id ] }.map { |entry, hours| clock_item("long_clock_today", "waiting", entry, hours) }
  end

  def clock_item(type, tone, entry, hours)
    {
      key: "#{type}:#{entry.id}",
      type: type,
      tone: tone,
      entry_id: entry.id,
      user: person(entry.user),
      work_date: entry.work_date.iso8601,
      clock_in_at: entry.clock_in_at&.in_time_zone(TimeClockService::BUSINESS_TIMEZONE)&.iso8601,
      status: entry.status,
      hours_so_far: hours,
      time_category: entry.time_category && { id: entry.time_category.id, name: entry.time_category.name }
    }
  end

  # Matches WhosWorkingQuery: time since clock-in, less breaks.
  def elapsed_hours(entry)
    return 0.0 unless entry.clock_in_at

    active_break = entry.active_break
    active_break_seconds = active_break&.start_time ? now - active_break.start_time : 0
    seconds = now - entry.clock_in_at - (entry.total_break_minutes.to_i * 60) - active_break_seconds
    (seconds / 3600.0).clamp(0, Float::INFINITY).round(2)
  end

  # The same numbers as the pending_approvals summary with no filters.
  def approvals_summary
    return unless viewer.can_approve_time?

    total_hours, count, oldest, pending_time, pending_overtime, manual, clock = self.class.waiting_scope.pick(
      Arel.sql("COALESCE(SUM(time_entries.hours), 0)"),
      Arel.sql("COUNT(time_entries.id)"),
      Arel.sql("MIN(time_entries.work_date)"),
      Arel.sql("SUM(CASE WHEN time_entries.approval_status = 'pending' THEN 1 ELSE 0 END)"),
      Arel.sql("SUM(CASE WHEN time_entries.overtime_status = 'pending' THEN 1 ELSE 0 END)"),
      Arel.sql("SUM(CASE WHEN time_entries.entry_method = 'manual' THEN 1 ELSE 0 END)"),
      Arel.sql("SUM(CASE WHEN time_entries.entry_method = 'clock' THEN 1 ELSE 0 END)")
    )
    {
      count: count.to_i,
      total_hours: total_hours.to_f.round(2),
      oldest_work_date: oldest&.iso8601,
      by_kind: {
        time: pending_time.to_i,
        overtime: pending_overtime.to_i,
        added: manual.to_i,
        clocked: clock.to_i
      }
    }
  end

  def approvals_item(approvals)
    return unless approvals && approvals[:count].positive?

    { key: "approvals_waiting", type: "approvals_waiting", tone: "waiting" }.merge(approvals)
  end

  # Counts, people and weeks come from one aggregate, so they stay exact and
  # equal the badge however long the backlog. Hours use the inbox's weekly
  # projection, which loads every shift in each affected week; it runs for
  # whole people, oldest waiting first, up to PROJECTED_OVERTIME_LIMIT
  # entries. Anyone past that gets hours: nil, and so does the total.
  def overtime_item
    return unless viewer.can_approve_time?

    week_start = "time_entries.work_date - EXTRACT(DOW FROM time_entries.work_date)::integer"
    rows = TimeEntry.where(overtime_status: "pending").group(:user_id).pluck(
      :user_id, Arel.sql("COUNT(*)"), Arel.sql("MIN(time_entries.work_date)"),
      Arel.sql("ARRAY_AGG(DISTINCT (#{week_start}) ORDER BY (#{week_start}))")
    )
    return if rows.empty?

    rows.sort_by! { |user_id, _count, oldest, _weeks| [ oldest, user_id ] }
    budget = PROJECTED_OVERTIME_LIMIT
    projected_ids = rows.take_while { |_user_id, count, _oldest, _weeks| (budget -= count) >= 0 }.map(&:first)
    hours_by_user = projected_overtime_hours(projected_ids)
    users = User.where(id: rows.map(&:first)).index_by(&:id)
    people = rows.map do |user_id, count, _oldest, weeks|
      person(users.fetch(user_id)).merge(hours: hours_by_user[user_id]&.round(2), entry_count: count, week_starts: weeks.map(&:iso8601))
    end
    unprojected = rows.sum { |user_id, count, _oldest, _weeks| hours_by_user.key?(user_id) ? 0 : count }
    {
      key: "overtime_waiting",
      type: "overtime_waiting",
      tone: "waiting",
      count: rows.sum(&:second),
      hours: unprojected.zero? ? hours_by_user.values.sum.round(2) : nil,
      hours_complete: unprojected.zero?,
      unprojected_count: unprojected,
      people: people.sort_by { |row| [ row[:hours] ? 0 : 1, -row[:hours].to_f, row[:full_name].to_s, row[:id] ] }
    }
  end

  def projected_overtime_hours(user_ids)
    return {} if user_ids.empty?

    entries = TimeEntry.where(overtime_status: "pending", user_id: user_ids).to_a
    allocations = Payroll::AffectedOvertimeReview.projected_allocations_for(entries)
    entries.group_by(&:user_id).transform_values do |rows|
      rows.sum { |entry| allocations[entry.id].to_h.fetch(:overtime_hours, 0).to_f }
    end
  end

  # The batch builder's rule: a shift with no category whose employee doesn't
  # have exactly one active category to fall back on blocks the lock.
  def missing_category_item(period)
    return unless viewer.can_manage_team_time? && period

    sole_category_users = UserTimeCategory.joins(:time_category).where(time_categories: { is_active: true })
      .group(:user_id).having("COUNT(*) = 1").select(:user_id)
    scope = TimeEntry.where(work_date: Date.iso8601(period[:start_date])..Date.iso8601(period[:end_date]),
                            status: "completed", time_category_id: nil)
      .where("time_entries.approval_status IS NULL OR time_entries.approval_status <> ?", "denied")
      .where.not(user_id: sole_category_users)
    count = scope.count
    return if count.zero?

    {
      key: "missing_category",
      type: "missing_category",
      tone: "needs_fix",
      count: count,
      entry_ids: scope.order(:work_date, :id).limit(MISSING_CATEGORY_SAMPLE).pluck(:id),
      period: period.slice(:start_date, :end_date)
    }
  end

  def payroll_problem_items
    return [] unless viewer.can_manage_payroll?

    items = []
    unless ConnectedPayrollMode.enabled?
      items << problem("connection_paused", "needs_fix", message: ConnectedPayrollMode::MESSAGE)
    end

    if (attention = Payroll::CutoffPresenter.attention(now: now))
      failed = PayrollCalendarPeriod.where(id: attention.dig(:period, :id), status: "failed").exists?
      items << problem(failed ? "lock_failed" : "lock_overdue", "needs_fix", period: attention[:period], lock_mode: attention[:lock_mode])
    end

    if (change = Payroll::LockControl.state(now: now)&.dig(:pending_change))
      kind = { "pending" => "lock_change_pending", "rejected" => "lock_change_refused", "expired" => "lock_change_expired" }.fetch(change[:state])
      items << problem(kind, change[:state] == "pending" ? "info" : "needs_fix", change: change)
    end
    items
  end

  def problem(kind, tone, **details)
    { key: "payroll_problem:#{kind}", type: "payroll_problem", tone: tone, problem: kind }.merge(details)
  end

  def leave_item
    return unless viewer.can_approve_leave?

    scope = LeaveRequest.pending_review
    count = scope.count
    return if count.zero?

    upcoming = scope.includes(:user).order(:start_date, :created_at, :id).first
    {
      key: "leave_waiting",
      type: "leave_waiting",
      tone: "waiting",
      count: count,
      next: {
        id: upcoming.id,
        user: person(upcoming.user),
        leave_type: upcoming.leave_type,
        start_date: upcoming.start_date&.iso8601,
        end_date: upcoming.end_date&.iso8601
      }
    }
  end

  def kiosk_pin_items
    return [] unless viewer.can_unlock_kiosk?

    User.where(is_active: true).where("kiosk_locked_until > ?", now).order(:kiosk_locked_until, :id).map do |user|
      {
        key: "kiosk_pin_locked:#{user.id}",
        type: "kiosk_pin_locked",
        tone: "info",
        user: person(user),
        locked_until: user.kiosk_locked_until.in_time_zone(TimeClockService::BUSINESS_TIMEZONE).iso8601
      }
    end
  end

  def pay_stub_item
    return unless viewer.can_send_pay_statements?

    scope = PayDocumentRequest.open_requests
    count = scope.count
    return if count.zero?

    {
      key: "pay_stub_requests",
      type: "pay_stub_requests",
      tone: "waiting",
      count: count,
      oldest_requested_at: scope.minimum(:created_at)&.in_time_zone(TimeClockService::BUSINESS_TIMEZONE)&.iso8601
    }
  end

  def person(user)
    { id: user.id, full_name: user.full_name, display_name: user.display_name }
  end
end
