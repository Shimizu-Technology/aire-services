# frozen_string_literal: true

module Payroll
  # Deliberately excludes payroll totals, identities, errors and integration credentials.
  class CutoffPresenter
    def self.period(now:)
      return unless ConnectedPayrollMode.enabled?
      scheduled = PayrollCalendarPeriod.scheduled_locks
      pending = scheduled.where.not(status: "finalized").order(:cutoff_at, :id).first
      return pending if pending && pending.cutoff_at <= now + 24.hours

      scheduled.where(status: "finalized", cutoff_at: ..now).order(cutoff_at: :desc, id: :desc).first || pending
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
    def self.attention
      period = PayrollCalendarPeriod.where(status: "failed").order(:cutoff_at, :id).first
      return unless period

      {
        period: { id: period.id, start_date: period.start_date.iso8601, end_date: period.end_date.iso8601 },
        lock_mode: period.lock_mode,
        cutoff_state: period.cutoff_state
      }
    end
  end
end
