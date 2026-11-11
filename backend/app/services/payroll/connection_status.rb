# frozen_string_literal: true

module Payroll
  # Health of the Cornerstone Payroll connection for owners and admins:
  # whether it is paused, what Payroll last published to AIRE, what AIRE last
  # delivered to Payroll, anything stuck on the way, and who linked the account.
  class ConnectionStatus
    STUCK_AFTER = PeriodHandoffState::DELIVERY_STUCK_AFTER
    PROBLEM_EVENT_LIMIT = 20

    def self.call(now: Time.current)
      new(now: now).call
    end

    def initialize(now: Time.current)
      @now = now
    end

    def call
      problems = problem_events
      capability = ConnectedPayrollMode.capability
      {
        mode: capability[:mode],
        enabled: capability[:enabled],
        message: capability[:message],
        state: state(capability[:enabled], problems),
        last_publication: last_publication,
        last_delivery: last_delivery,
        undelivered: {
          count: undelivered.count,
          failed_count: problems.count { |event| event[:state] == "failed" },
          stuck_count: problems.count { |event| event[:state] == "stuck" },
          events: problems
        },
        account_link: account_link,
        active_link_count: active_links.count
      }
    end

    private

    attr_reader :now

    def state(enabled, problems)
      return "paused" unless enabled
      return "delivery_problem" if problems.any?

      "connected"
    end

    # Revisions are written only for publications AIRE accepted.
    def last_publication
      revision = PayrollCalendarPeriodRevision.includes(:payroll_calendar_period).order(published_at: :desc, id: :desc).first
      return unless revision

      period = revision.payroll_calendar_period
      {
        external_pay_period_id: period.external_pay_period_id,
        start_date: period.start_date.iso8601,
        end_date: period.end_date.iso8601,
        schedule_version: revision.schedule_version,
        publication_id: revision.publication_id,
        published_at: local(revision.published_at)
      }
    end

    def last_delivery
      event = PayrollOutboxEvent.includes(:payroll_calendar_period).where(delivery_status: "delivered")
        .order(delivered_at: :desc, id: :desc).first
      event && event_json(event).merge(delivered_at: local(event.delivered_at))
    end

    def undelivered
      PayrollOutboxEvent.where(delivery_status: %w[pending failed])
    end

    # Failed: Cornerstone refused it or couldn't be reached; retries continue.
    # Stuck: still pending well after the lock that created it.
    def problem_events
      @problem_events ||= undelivered.includes(:payroll_calendar_period)
        .where("delivery_status = 'failed' OR occurred_at <= ?", now - STUCK_AFTER)
        .order(:occurred_at, :id).limit(PROBLEM_EVENT_LIMIT)
        .map do |event|
          event_json(event).merge(
            state: event.delivery_status == "failed" ? "failed" : "stuck",
            attempts: event.delivery_attempts,
            last_attempt_at: local(event.last_delivery_attempt_at),
            next_attempt_at: local(event.next_delivery_attempt_at),
            last_response_status: event.last_response_status,
            last_error: event.last_error&.truncate(300)
          )
        end
    end

    def event_json(event)
      period = event.payroll_calendar_period
      {
        event_id: event.event_id,
        event_type: event.event_type,
        occurred_at: local(event.occurred_at),
        period: { external_pay_period_id: period.external_pay_period_id, start_date: period.start_date.iso8601, end_date: period.end_date.iso8601 }
      }
    end

    def active_links
      PayrollAccountLink.active.where(external_system: PayrollAccountLink::EXTERNAL_SYSTEM)
    end

    # The most recent active link: the AIRE admin who approved it, the
    # Cornerstone Payroll account on the other end, and when.
    def account_link
      link = active_links.includes(:user).order(linked_at: :desc, id: :desc).first
      return unless link

      {
        aire_user: { id: link.user.id, full_name: link.user.full_name },
        payroll_user_email: link.external_actor_email,
        linked_at: local(link.linked_at),
        connected: link.connected?
      }
    end

    def local(time)
      PeriodHandoffState.local(time)
    end
  end
end
