# frozen_string_literal: true

module Payroll
  # Deliberately excludes payroll totals, identities, errors and integration credentials.
  class CutoffPresenter
    def self.period(now:)
      scheduled = PayrollCalendarPeriod.scheduled_locks
      pending = scheduled.where.not(status: "finalized").order(:cutoff_at, :id).first
      return pending if pending && pending.cutoff_at <= now + 24.hours

      scheduled.where(status: "finalized", cutoff_at: ..now).order(cutoff_at: :desc, id: :desc).first || pending
    end

    def self.call(now: Time.current, period: self.period(now: now))
      seconds = period && (period.cutoff_at - now).ceil
      stage = if period.nil?
        "none"
      elsif seconds <= 0
        period.status == "finalized" ? "passed" : "finalizing"
      elsif seconds <= 4.hours
        "4h"
      elsif seconds <= 24.hours
        "24h"
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
  end
end
