# frozen_string_literal: true

require "cgi"

module Payroll
  # Emails approvers before a scheduled cutoff while hours still need approval.
  # The audit record marks each send, so a retry cannot email the same reminder twice.
  class CutoffApprovalReminder
    ACTION = "payroll_cutoff.approval_reminder_sent"
    DAYS_BEFORE = [ 2, 1 ].freeze
    SEND_FROM_HOUR = 8

    def self.call_due(now: Time.current)
      return [] unless ConnectedPayrollMode.enabled?

      PayrollCalendarPeriod.scheduled_locks.where(status: "scheduled", cutoff_at: now..(now + 3.days)).order(:cutoff_at, :id).map do |period|
        new(period: period, now: now).call
      rescue StandardError => e
        Rails.error.report(e, handled: true, severity: :error, context: { operation: "payroll_cutoff_approval_reminder", period_id: period.id })
        { period_id: period.id, status: "failed" }
      end
    end

    def initialize(period:, now: Time.current)
      @period = period
      @now = now
    end

    def call
      return result("not_due") unless due?

      period.with_lock do
        next result("already_sent") if already_sent?

        rows = pending_rows
        next result("nothing_pending") if rows.empty?

        recipients = Setting.payroll_cutoff_reminder_emails
        next result("no_recipients") if recipients.empty?

        StagingMailTransport.deliver(
          { from: ENV.fetch("MAILER_FROM_EMAIL", "noreply@example.com"), to: recipients, subject: subject(rows), html: html(rows) },
          options: { idempotency_key: "payroll-cutoff-reminder-#{period.id}-#{local_cutoff.strftime("%Y%m%d%H%M")}-#{days_before}" }
        )
        AuditLog.record!(action: ACTION, actor: nil, actor_kind: "system", source: "system", auditable: period, event_category: "payroll",
          metadata: { days_before: days_before, cutoff_at: period.cutoff_at.iso8601, entry_count: rows.sum { |row| row[:entries] }, recipient_count: recipients.size })
        result("sent")
      end
    end

    private

    attr_reader :period, :now

    def result(status)
      { period_id: period.id, status: status }
    end

    def local_now
      now.in_time_zone(period.time_zone)
    end

    def local_cutoff
      period.cutoff_at.in_time_zone(period.time_zone)
    end

    def days_before
      (local_cutoff.to_date - local_now.to_date).to_i
    end

    def due?
      DAYS_BEFORE.include?(days_before) && local_now.hour >= SEND_FROM_HOUR
    end

    # A moved lock time gets its own reminders. Older audit rows carry no
    # cutoff_at and keep suppressing a resend for the date they were sent for.
    def already_sent?
      AuditLog.where(action: ACTION, auditable: period).where("metadata ->> 'days_before' = ?", days_before.to_s)
        .where("metadata ->> 'cutoff_at' IS NULL OR metadata ->> 'cutoff_at' = ?", period.cutoff_at.iso8601).exists?
    end

    def first_enforced_date
      PayrollLockRollout.find_by(id: 1)&.cutoff_enforcement_starts_on || period.start_date
    end

    # Older enforced dates are included because those hours are still unpaid.
    def pending_rows
      TimeEntry.includes(:user).where(status: "completed", work_date: first_enforced_date..period.end_date)
        .where("approval_status = 'pending' OR (overtime_status = 'pending' AND approval_status IS DISTINCT FROM 'denied')")
        .group_by(&:user).map do |user, entries|
          { name: user.full_name, entries: entries.size, hours: entries.sum { |entry| entry.hours.to_d },
            needs_time: entries.count { |entry| entry.approval_status == "pending" },
            needs_overtime: entries.count { |entry| entry.overtime_status == "pending" } }
        end.sort_by { |row| row[:name].to_s }
    end

    def deadline
      local_cutoff.strftime("%A, %b %-d at %-l:%M %p")
    end

    def subject(rows)
      count = rows.sum { |row| row[:entries] }
      "Approve AIRE time by #{deadline}: #{count} #{'entry'.pluralize(count)} waiting"
    end

    def html(rows)
      # Older emails link to /admin/time?tab=approvals, which the app redirects here.
      link = "#{ENV.fetch('FRONTEND_URL', 'http://localhost:5173')}/admin/approvals"
      lines = rows.map do |row|
        needs = [ ("#{row[:needs_time]} time" if row[:needs_time].positive?), ("#{row[:needs_overtime]} overtime" if row[:needs_overtime].positive?) ].compact.join(", ")
        "<tr><td>#{CGI.escapeHTML(row[:name].to_s)}</td><td>#{format('%.2f', row[:hours])}</td><td>#{needs}</td></tr>"
      end
      <<~HTML
        <p>These hours still need approval for the #{period.start_date.strftime('%b %-d')}&ndash;#{period.end_date.strftime('%b %-d')} payroll. Please approve them by <strong>#{deadline}</strong>.</p>
        <table cellpadding="6"><tr><th align="left">Employee</th><th align="left">Hours</th><th align="left">Needs approval</th></tr>#{lines.join}</table>
        <p>Anything approved after the cutoff moves to the next payroll.</p>
        <p><a href="#{CGI.escapeHTML(link)}">Open approvals</a></p>
      HTML
    end
  end
end
