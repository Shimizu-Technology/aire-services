# frozen_string_literal: true

module Payroll
  # Where a published pay period is in the hand-off to Cornerstone Payroll:
  # open, locked by AIRE, received by Payroll, in a payroll run, or paid.
  # Periods before scheduled locking started are "before_locking".
  #
  # Reads only. The state comes from the calendar period, its frozen batch and
  # the processing events Cornerstone reports back; nothing here changes them.
  class PeriodHandoffState
    STATES = %w[open locked received in_run paid before_locking].freeze
    STEPS = %w[open locked received in_run paid].freeze
    # The glossary draft (DESIGN.md §5). Chels hasn't confirmed these yet.
    LABELS = {
      "open" => "Open",
      "locked" => "Locked for payroll",
      "received" => "Received by Payroll",
      "in_run" => "In a payroll run",
      "paid" => "Paid",
      "before_locking" => "Before locking"
    }.freeze
    LABELS_PROVISIONAL = true
    LABEL_NOTE = "Plain labels from the glossary draft, pending Chels's confirmation."
    # Batch processing status (Batch#processing_summary) to hand-off step.
    # Payment problems stay "in a payroll run"; payroll_status says which.
    RECEIVED_STATUSES = %w[imported].freeze
    PAID_STATUSES = %w[payment_issued].freeze
    DELIVERY_STUCK_AFTER = 10.minutes
    INDEX_LIMIT = 12
    INDEX_MAX = 48

    def self.labels
      { provisional: LABELS_PROVISIONAL, note: LABEL_NOTE, states: LABELS }
    end

    def self.index(limit: INDEX_LIMIT, now: Time.current)
      rollout = PayrollLockRollout.find_by(id: 1)
      periods = preload(PayrollCalendarPeriod.order(start_date: :desc, id: :desc).limit(limit.to_i.clamp(1, INDEX_MAX))).to_a
      periods.map { |period| new(period, now: now, rollout: rollout).as_json }
    end

    def self.find(start_date, now: Time.current)
      period = preload(PayrollCalendarPeriod.where(start_date: start_date)).first
      period && new(period, now: now, rollout: PayrollLockRollout.find_by(id: 1))
    end

    # The period Today and the pay period page treat as current: the earliest
    # scheduled period not yet locked, else the semimonthly dates around today.
    def self.current_period(today:)
      PayrollCalendarPeriod.scheduled_locks.where.not(status: "finalized").order(:start_date, :id).first ||
        PayrollCalendarPeriod.where("start_date <= ? AND end_date >= ?", today, today).first
    end

    def self.current_period_summary(today:, now: Time.current)
      period = current_period(today: today)
      if period
        state = new(period, now: now)
        return {
          published: true,
          id: period.id,
          external_pay_period_id: period.external_pay_period_id,
          start_date: period.start_date.iso8601,
          end_date: period.end_date.iso8601,
          pay_date: period.pay_date.iso8601,
          cutoff_at: local(period.cutoff_at),
          handoff_state: state.handoff_state,
          label: LABELS.fetch(state.handoff_state),
          label_provisional: LABELS_PROVISIONAL
        }.merge(live_hours(period.start_date, period.end_date))
      end

      start_date, end_date = semimonthly_dates(today)
      { published: false, start_date: start_date.iso8601, end_date: end_date.iso8601, handoff_state: nil }
        .merge(live_hours(start_date, end_date))
    end

    # Approved and waiting hours from the live entries. An entry with overtime
    # waiting counts as waiting in full, so the two never overlap, and the
    # waiting numbers equal the pending_approvals summary for these dates.
    def self.live_hours(start_date, end_date)
      range = start_date..end_date
      waiting_hours, waiting_count = AttentionQuery.waiting_scope.where(work_date: range)
        .pick(Arel.sql("COALESCE(SUM(time_entries.hours), 0)"), Arel.sql("COUNT(time_entries.id)"))
      approved = TimeEntry.countable.where(work_date: range).where("time_entries.overtime_status IS DISTINCT FROM 'pending'")
      approved_hours = approved.sum(:hours)
      people = TimeEntry.where(id: approved.select(:id)).or(TimeEntry.where(id: AttentionQuery.waiting_scope.where(work_date: range).select(:id)))
        .distinct.count(:user_id)
      {
        people: people,
        approved_hours: approved_hours.to_f.round(2),
        waiting_hours: waiting_hours.to_f.round(2),
        waiting_count: waiting_count.to_i,
        hours_source: "live"
      }
    end

    def self.semimonthly_dates(date)
      date.day <= 15 ? [ date.beginning_of_month, date.change(day: 15) ] : [ date.change(day: 16), date.end_of_month ]
    end

    def self.local(time)
      time&.in_time_zone(PayrollCalendarPeriod::BUSINESS_TIME_ZONE)&.iso8601
    end

    def self.preload(scope)
      scope.includes(:payroll_outbox_events,
                     payroll_batch: [ :payroll_batch_processing_events, :payroll_batch_entries, :payroll_entry_processing_events ])
    end
    private_class_method :preload

    def initialize(period, now: Time.current, rollout: PayrollLockRollout.find_by(id: 1))
      @period = period
      @now = now
      @rollout = rollout
    end

    def handoff_state
      @handoff_state ||= if !period.scheduled_lock_enforced?(rollout: rollout)
        "before_locking"
      elsif period.status != "finalized" || period.payroll_batch.nil?
        "open"
      else
        status = payroll_processing&.fetch(:status, nil)
        if status.nil? || status == "finalized"
          "locked"
        elsif RECEIVED_STATUSES.include?(status)
          "received"
        elsif PAID_STATUSES.include?(status)
          "paid"
        else
          "in_run"
        end
      end
    end

    def as_json(*)
      state = handoff_state
      {
        id: period.id,
        external_pay_period_id: period.external_pay_period_id,
        start_date: period.start_date.iso8601,
        end_date: period.end_date.iso8601,
        pay_date: period.pay_date.iso8601,
        cutoff_at: local(period.cutoff_at),
        lock_mode: period.lock_mode,
        status: period.status,
        cutoff_state: period.cutoff_state(now: now, rollout: rollout),
        cutoff_source: period.cutoff_source,
        override: override_json,
        lock_change: lock_change,
        handoff_state: state,
        label: LABELS.fetch(state),
        label_provisional: LABELS_PROVISIONAL,
        steps: steps(state),
        locked_at: period.status == "finalized" ? local(period.finalized_at) : nil,
        payroll_batch_id: period.payroll_batch&.public_id,
        delivery: delivery_json,
        payroll_status: payroll_status_json,
        **hours_json
      }
    end

    private

    attr_reader :period, :now, :rollout

    def local(time)
      self.class.local(time)
    end

    def steps(state)
      return [] if state == "before_locking"

      current = STEPS.index(state)
      STEPS.each_with_index.map do |key, index|
        progress = if index < current || state == "paid"
          "done"
        else
          (index == current ? "current" : "upcoming")
        end
        { key: key, label: LABELS.fetch(key), state: progress }
      end
    end

    def payroll_processing
      return @payroll_processing if defined?(@payroll_processing)

      @payroll_processing = period.payroll_batch&.processing_summary
    end

    # The summary serializes occurred_at in the app zone (UTC); the contract
    # gives every time in Guam.
    def payroll_status_json
      return unless payroll_processing

      occurred_at = payroll_processing[:occurred_at]
      { status: payroll_processing[:status], occurred_at: occurred_at && local(Time.iso8601(occurred_at.to_s)) }
    end

    # The finalized-batch event AIRE sends at the lock. "Locked" but not
    # received usually means this hasn't arrived or Cornerstone refused it.
    def delivery_json
      event = period.payroll_outbox_events.max_by { |row| [ row.occurred_at, row.id ] }
      return unless event

      stuck = event.delivery_status != "delivered" && event.occurred_at <= now - DELIVERY_STUCK_AFTER
      {
        event_id: event.event_id,
        status: event.delivery_status,
        stuck: stuck,
        attempts: event.delivery_attempts,
        occurred_at: local(event.occurred_at),
        delivered_at: local(event.delivered_at),
        last_attempt_at: local(event.last_delivery_attempt_at),
        next_attempt_at: local(event.next_delivery_attempt_at),
        last_response_status: event.last_response_status,
        last_error: event.last_error&.truncate(300)
      }
    end

    # Matches LockControl#override_json so both cards read the same.
    def override_json
      return unless period.cutoff_overridden?

      details = period.cutoff_override
      {
        action: details["action"],
        reason: details["reason"],
        set_at: details["set_at"],
        set_by_name: details.dig("set_by", "name"),
        set_by_system: details.dig("set_by", "system"),
        policy_cutoff_at: local(period.policy_cutoff_at),
        previous_cutoff_at: details["previous_cutoff_at"]
      }
    end

    # A lock-time change asked for from AIRE: pending, refused or expired.
    # Only the period lock control acts on carries one.
    def lock_change
      return unless period.status != "finalized" && period.scheduled_lock_enforced?(rollout: rollout)
      return unless LockControl.period&.id == period.id

      LockControl.state(now: now, period: period)&.dig(:pending_change)
    end

    def hours_json
      summary = period.payroll_batch&.summary
      return self.class.live_hours(period.start_date, period.end_date) unless period.status == "finalized" && summary.present?

      {
        people: summary["employee_count"].to_i,
        locked_hours: summary["total_hours"].to_f.round(2),
        locked_regular_hours: summary["regular_hours"].to_f.round(2),
        locked_overtime_hours: summary["overtime_hours"].to_f.round(2),
        hours_source: "locked"
      }
    end
  end
end
