# frozen_string_literal: true

module Payroll
  # Deliberately excludes payroll totals, identities, errors and integration credentials.
  class CutoffPresenter
    NOTICE_RETENTION = 3.days
    def self.period(now:)
      return unless ConnectedPayrollMode.enabled?
      scheduled = PayrollCalendarPeriod.scheduled_locks
      pending_periods = scheduled.where.not(status: "finalized").order(:cutoff_at, :id)
      pending = pending_periods.where("cutoff_at > ?", now - NOTICE_RETENTION).first
      return pending if pending && pending.cutoff_at <= now + 24.hours

      scheduled.where(status: "finalized", cutoff_at: ..now).order(cutoff_at: :desc, id: :desc).first || pending || pending_periods.first
    end

    # Preparation is independent of the short-lived employee reminder window.
    def self.preparation_period
      return unless ConnectedPayrollMode.enabled?

      period = PayrollCalendarPeriod.where.not(status: "finalized").order(:start_date, :id).first
      period && { id: period.id, start_date: period.start_date.iso8601, end_date: period.end_date.iso8601 }
    end

    def self.call(now: Time.current, period: self.period(now: now))
      period = nil unless ConnectedPayrollMode.enabled?
      seconds = period && (period.cutoff_at - now).ceil
      # Admins retain attention_required for manual failures. Employee notices
      # never treat a manual publication as a cutoff, even when passed directly.
      state = period&.manual_lock? ? "manual" : period&.cutoff_state(now: now)
      stage = case state
      when "finalized", "attention_required"
        # An unresolved failed publication can still be the next cutoff, but it
        # is not pending. Never present it as a countdown or active finalization.
        seconds <= 0 ? "passed" : "none"
      when "due"
        "finalizing"
      when "upcoming"
        if seconds <= 4.hours
          "4h"
        elsif seconds <= 24.hours
          "24h"
        else
          "none"
        end
      else
        "none"
      end
      # Only the reminder expires. The lock and separate admin failure
      # attention projection retain their existing state and timing.
      stage = "none" if period && now >= period.cutoff_at + NOTICE_RETENTION
      {
        period: period && { id: period.id, start_date: period.start_date.iso8601, end_date: period.end_date.iso8601 },
        publication_id: period&.publication_id,
        version: period&.lock_version,
        now: now.iso8601,
        cutoff_at: period&.cutoff_at&.iso8601,
        seconds_remaining: seconds,
        time_zone: PayrollCalendarPeriod::BUSINESS_TIME_ZONE,
        stage: stage
      }
    end

    # Called only by the authenticated admin response, never staff/kiosk discovery.
    def self.attention(now: Time.current)
      overdue = PayrollCalendarPeriod.scheduled_locks.where(status: "scheduled", cutoff_at: ..now)
      period = PayrollCalendarPeriod.where(status: "failed").or(PayrollCalendarPeriod.where(id: overdue.select(:id))).order(:cutoff_at, :id).first
      return unless period

      {
        period: { id: period.id, start_date: period.start_date.iso8601, end_date: period.end_date.iso8601 },
        lock_mode: period.lock_mode,
        cutoff_state: "attention_required"
      }
    end
  end
end
