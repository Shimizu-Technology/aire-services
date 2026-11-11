# frozen_string_literal: true

module Payroll
  # The next scheduled AIRE lock and the admin actions for it. Cornerstone
  # Payroll stays the source of truth: AIRE asks it to change the lock time,
  # and the change takes effect here when Cornerstone republishes the period.
  class LockControl
    ACTIONS = %w[lock_now change reset].freeze
    REASON_MAX = 500

    class Error < StandardError; end

    def self.period
      PayrollCalendarPeriod.scheduled_locks.where(status: %w[scheduled failed]).order(:cutoff_at, :id).first
    end

    def self.state(now: Time.current, period: self.period)
      return unless ConnectedPayrollMode.enabled? && period

      new(period: period, now: now).state
    end

    def initialize(period:, now: Time.current)
      @period = period
      @now = now
    end

    def state
      earliest = PayrollCalendarPeriod.earliest_override_at(period.end_date)
      latest = PayrollCalendarPeriod.latest_override_at(period.pay_date)
      {
        period: {
          id: period.id,
          external_pay_period_id: period.external_pay_period_id,
          start_date: period.start_date.iso8601,
          end_date: period.end_date.iso8601,
          pay_date: period.pay_date.iso8601
        },
        publication_id: period.publication_id,
        schedule_version: period.schedule_version,
        status: period.status,
        cutoff_state: period.cutoff_state(now: now),
        cutoff_at: local(period.cutoff_at),
        cutoff_source: period.cutoff_source,
        default_cutoff_at: local(period.default_cutoff_at),
        override: override_json,
        earliest_cutoff_at: local([ earliest, now ].max),
        latest_cutoff_at: local(latest),
        lock_now_available_at: local(earliest),
        can_change: changeable?,
        can_lock_now: changeable? && now >= earliest && now <= latest,
        can_reset: changeable? && period.cutoff_overridden? && period.default_cutoff_at > now,
        unavailable_reason: unavailable_reason
      }
    end

    # Validates locally for a clear message, then asks Cornerstone. AIRE is
    # updated later by Cornerstone's publication, never by this call.
    def request!(user:, action:, reason:, publication_id:, request_id:, cutoff_at: nil)
      raise Error, "Owner or admin access required" unless user&.can_manage_payroll?
      raise Error, "Choose lock now, change, or reset" unless ACTIONS.include?(action.to_s)
      raise Error, "This pay period changed. Refresh and try again." unless publication_id.to_s == period.publication_id

      reason = reason.to_s.strip
      raise Error, "Enter a reason for the change" if reason.blank?
      raise Error, "Keep the reason under #{REASON_MAX} characters" if reason.length > REASON_MAX

      target = validate_action!(action.to_s, cutoff_at)
      change = CutoffChangeClient.new.request_change(
        external_pay_period_id: period.external_pay_period_id,
        action: action.to_s,
        cutoff_at: target,
        reason: reason,
        actor: actor_json(user),
        request_id: request_id
      )
      audit!(user, action, target, reason, "succeeded", change: change)
      change
    rescue CutoffChangeClient::Error => e
      audit!(user, action, target, reason, "failed", error: e.message)
      raise
    end

    private

    attr_reader :period, :now

    def changeable?
      unavailable_reason.nil?
    end

    def unavailable_reason
      return "Connected payroll is paused" unless ConnectedPayrollMode.enabled?
      return "This period locks manually from Cornerstone Payroll" unless period.scheduled_lock_enforced?
      return "This period needs attention before its lock time can change" unless period.status == "scheduled"
      return "This period is already locking" if period.cutoff_at <= now
      return "It is too close to payday to change the lock time" if PayrollCalendarPeriod.latest_override_at(period.pay_date) <= now

      nil
    end

    def validate_action!(action, cutoff_at)
      raise Error, unavailable_reason || "This lock time cannot change now" unless changeable?

      case action
      when "lock_now"
        earliest = PayrollCalendarPeriod.earliest_override_at(period.end_date)
        raise Error, "Lock now is available after the period ends (#{earliest.strftime('%b %-d')})" if now < earliest

        nil
      when "change"
        time = parse_time(cutoff_at)
        earliest = PayrollCalendarPeriod.earliest_override_at(period.end_date)
        latest = PayrollCalendarPeriod.latest_override_at(period.pay_date)
        raise Error, "Choose a time in the future" unless time > now
        raise Error, "Choose a time after the period ends" if time < earliest
        raise Error, "Choose a time at least two days before payday" if time > latest

        time
      when "reset"
        raise Error, "This period already uses the default lock time" unless period.cutoff_overridden?
        raise Error, "The default lock time has already passed. Use Lock now instead." unless period.default_cutoff_at > now

        nil
      end
    end

    def parse_time(value)
      text = value.to_s
      raise Error, "Choose a new lock time" if text.blank?
      raise Error, "Choose a valid lock time" unless text.match?(/(?:Z|[+-]\d{2}:\d{2})\z/i)

      Time.iso8601(text).in_time_zone(PayrollCalendarPeriod::BUSINESS_TIME_ZONE).change(sec: 0)
    rescue ArgumentError
      raise Error, "Choose a valid lock time"
    end

    def actor_json(user)
      link = PayrollAccountLink.active.find_by(user: user, external_system: PayrollAccountLink::EXTERNAL_SYSTEM)
      {
        system: "aire_services",
        user_id: user.id,
        name: user.full_name,
        email: user.email,
        role: user.role,
        payroll_user_id: link&.external_actor_id
      }.compact
    end

    def override_json
      return unless period.cutoff_overridden?

      details = period.cutoff_override
      {
        action: details["action"],
        reason: details["reason"],
        set_at: details["set_at"],
        set_by_name: details.dig("set_by", "name"),
        set_by_system: details.dig("set_by", "system"),
        previous_cutoff_at: details["previous_cutoff_at"]
      }
    end

    def audit!(user, action, target, reason, outcome, change: nil, error: nil)
      AuditLog.record!(
        action: "payroll_calendar_period.cutoff_change_requested",
        actor: user,
        source: "admin",
        event_category: "payroll",
        outcome: outcome,
        auditable: period,
        metadata: {
          external_pay_period_id: period.external_pay_period_id,
          requested_action: action.to_s,
          requested_cutoff_at: target&.iso8601,
          current_cutoff_at: period.cutoff_at.iso8601,
          reason: reason,
          cornerstone_override_id: change&.fetch("override_id", nil),
          cornerstone_cutoff_at: change&.fetch("cutoff_at", nil),
          error: error
        }.compact
      )
    end

    def local(time)
      time&.in_time_zone(PayrollCalendarPeriod::BUSINESS_TIME_ZONE)&.iso8601
    end
  end
end
