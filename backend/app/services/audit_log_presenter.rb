# frozen_string_literal: true

class AuditLogPresenter
  SUBJECTLESS_ACTIONS = %w[
    auth.signed_in auth.sign_in_failed auth.access_denied authorization.admin_denied
    authorization.staff_denied kiosk.verified kiosk.verification_failed kiosk.unlocked audit_history.exported
    pay_documents.request_created
  ].freeze
  VERBS = {
    "auth.signed_in" => "Signed in",
    "auth.sign_in_failed" => "Failed to sign in",
    "auth.access_denied" => "Was denied access",
    "authorization.admin_denied" => "Was denied administrator access",
    "authorization.staff_denied" => "Was denied staff access",
    "kiosk.verified" => "Started a kiosk session",
    "kiosk.verification_failed" => "Failed kiosk verification",
    "kiosk.unlocked" => "Unlocked the kiosk",
    "time_entry.created" => "Created",
    "time_entry.updated" => "Edited",
    "time_entry.deleted" => "Deleted",
    "time_entry.submitted" => "Submitted",
    "time_entry.approved" => "Approved",
    "time_entry.denied" => "Denied",
    "time_entry.overtime_approved" => "Approved overtime for",
    "time_entry.overtime_denied" => "Denied overtime for",
    "time_entry.clocked_in" => "Clocked in for",
    "time_entry.clocked_out" => "Clocked out from",
    "time_entry.legacy_lock_archived" => "Archived legacy lock state for",
    "leave_request.created" => "Requested leave for",
    "leave_request.approved" => "Approved leave for",
    "leave_request.declined" => "Declined leave for",
    "leave_request.cancelled" => "Cancelled leave for",
    "user.created" => "Created",
    "user.updated" => "Updated",
    "user.deleted" => "Deleted",
    "user.invite_resent" => "Resent an invitation for",
    "user.kiosk_pin_reset" => "Reset kiosk access for",
    "user.kiosk_pin_set" => "Set a kiosk PIN for",
    "report.exported" => "Exported",
    "payroll_batch.finalized" => "Finalized",
    "payroll_batch.exported" => "Exported",
    "payroll_batch.retrieved" => "Retrieved",
    "payroll_settlement_case.routed" => "Routed held time for",
    "payroll_settlement_case.rerouted" => "Changed the held-time destination for",
    "payroll_settlement_case.marked_not_payable" => "Closed unpaid time for",
    "legacy_time_period_lock.archived" => "Archived",
    "audit_history.exported" => "Exported activity history",
    "pay_documents.request_created" => "Requested a pay stub",
    "pay_documents.request_notice_sent" => "Sent a pay stub request notice for",
    "pay_documents.request_dismissed" => "Dismissed a pay stub request from",
    "pay_documents.link_sent" => "Sent a pay stub link to",
    "pay_documents.link_revoked" => "Revoked a pay stub link for",
    "pay_documents.link_downloaded" => "Downloaded a pay stub for",
    "pay_documents.link_download_denied" => "Was denied a pay stub download for"
  }.freeze

  # Time and leave events name the employee in metadata; a time entry's frozen
  # subject is only "8.0 hours on 2026-11-10". "self" applies when people act on
  # their own record. Clock events predating that metadata were always self-service.
  EMPLOYEE_SENTENCES = {
    "time_entry.clocked_in" => { self: "clocked in", other: "clocked in %{employee}", legacy_self: true },
    "time_entry.clocked_out" => { self: "clocked out", other: "clocked out %{employee}", legacy_self: true },
    "time_entry.break_started" => { self: "started a break", other: "started a break for %{employee}", legacy_self: true },
    "time_entry.break_ended" => { self: "ended a break", other: "ended a break for %{employee}", legacy_self: true },
    "time_entry.category_switched" => { self: "switched work category", other: "switched work category for %{employee}", legacy_self: true },
    "time_entry.auto_closed" => { other: "automatically clocked out %{employee} after a long open shift" },
    "time_entry.clock_ended" => { other: "entered the missed clock-out for %{employee}%{on_date}" },
    "time_entry.created" => { self: "added %{hours} of their own time%{on_date}", other: "added %{hours} for %{employee}%{on_date}" },
    "time_entry.approved" => { other: "approved %{employee_possessive} time%{on_date}" },
    "time_entry.denied" => { other: "denied %{employee_possessive} time%{on_date}" },
    "time_entry.overtime_approved" => { other: "approved %{employee_possessive} overtime%{on_date}" },
    "time_entry.overtime_denied" => { other: "denied %{employee_possessive} overtime%{on_date}" },
    "leave_request.created" => { self: "requested leave for %{subject}" },
    "leave_request.approved" => { other: "approved %{employee_possessive} leave for %{subject}" },
    "leave_request.declined" => { other: "declined %{employee_possessive} leave for %{subject}" },
    "leave_request.cancelled" => { self: "cancelled their leave request for %{subject}", other: "cancelled %{employee_possessive} leave request for %{subject}" }
  }.freeze

  # The worker is both actor and subject of their own My Pay views; previews
  # name the worker whose pay an admin looked at.
  MY_PAY_SENTENCES = {
    "my_pay.statements_viewed" => "viewed their pay statements",
    "my_pay.statement_viewed" => "opened one of their pay statements",
    "my_pay.statement_pdf_downloaded" => "downloaded one of their pay statements",
    "my_pay.preview_statements_viewed" => "previewed %{subject_possessive} My Pay",
    "my_pay.preview_statement_viewed" => "previewed a pay statement for %{subject}",
    "my_pay.preview_statement_pdf_downloaded" => "downloaded a preview pay statement for %{subject}"
  }.freeze

  OUTCOME_NOTES = { "failed" => "could not load", "denied" => "denied" }.freeze
  ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/

  attr_reader :audit_log

  def initialize(audit_log)
    @audit_log = audit_log
  end

  def actor
    # Whoever opened an emailed pay stub link; they don't sign in to AIRE.
    return "Link recipient" if audit_log.actor_name.blank? && metadata["accessed_by"] == "link_recipient"

    audit_log.actor_name.presence || audit_log.actor_email.presence || audit_log.actor_kind.to_s.humanize
  end

  def subject
    audit_log.subject_name.presence || "#{audit_log.auditable_type.underscore.humanize.downcase} ##{audit_log.auditable_id}"
  end

  def summary
    sentence = employee_sentence || my_pay_sentence || access_sentence
    return readable_dates("#{actor} #{sentence}".squish) if sentence

    verb = VERBS[audit_log.action]
    return fallback_summary unless verb
    return "#{actor} #{verb.downcase}".squish if SUBJECTLESS_ACTIONS.include?(audit_log.action)

    readable_dates("#{actor} #{verb.downcase} #{subject}".squish)
  end

  private

  def metadata
    audit_log.metadata.is_a?(Hash) ? audit_log.metadata : {}
  end

  def recorded_changes
    audit_log.changes_made.is_a?(Hash) ? audit_log.changes_made : {}
  end

  def employee_sentence
    template = EMPLOYEE_SENTENCES[audit_log.action]
    return unless template

    employee = metadata["employee_name"].presence
    own = own_record?(metadata["employee_id"])
    pattern = if employee.nil?
      template[:self] if template[:legacy_self]
    elsif own
      template[:self] || template[:other]
    else
      template[:other]
    end
    return unless pattern

    work_date = metadata["work_date"].presence
    format(pattern, employee: own ? "themselves" : employee.to_s,
           employee_possessive: own ? "their own" : possessive(employee),
           on_date: work_date ? " for #{work_date}" : "", hours: hours_phrase(metadata["hours"]), subject: subject)
  end

  def my_pay_sentence
    template = MY_PAY_SENTENCES[audit_log.action]
    return unless template

    sentence = format(template, subject: subject, subject_possessive: possessive(subject))
    note = OUTCOME_NOTES[audit_log.outcome]
    note ? "#{sentence} (#{note})" : sentence
  end

  def access_sentence
    case audit_log.action
    when "user.role_changed"
      from, to = Array(recorded_changes["role"])
      return "changed #{possessive(subject)} role" if to.blank?

      from.present? ? "changed #{possessive(subject)} role from #{from.to_s.humanize} to #{to.to_s.humanize}" : "made #{subject} #{to.to_s.humanize.downcase}"
    when "user.my_pay_access_changed"
      enabled = Array(recorded_changes["my_pay_enabled"]).last
      "turned My Pay #{enabled ? 'on' : 'off'} for #{subject}" unless enabled.nil?
    when "setting.my_pay_everyone_updated"
      "turned My Pay #{metadata['enabled'] ? 'on' : 'off'} for everyone" if metadata.key?("enabled")
    when "setting.schedules_enabled_updated"
      "turned schedules #{metadata['enabled'] ? 'on' : 'off'}" if metadata.key?("enabled")
    end
  end

  # Events without a sentence still read as "who · what · whom", never as a raw key.
  def fallback_summary
    phrase = audit_log.action.to_s.split(".").map { |part| part.tr("_", " ") }.join(": ").humanize
    readable_dates([ actor, phrase, (subject unless subject == actor) ].compact.join(" · "))
  end

  def own_record?(employee_id)
    employee_id.present? && audit_log.user_id.present? && employee_id.to_i == audit_log.user_id
  end

  def hours_phrase(value)
    return "time" if value.blank?

    number = value.to_f.round(2)
    "#{number % 1 == 0 ? number.to_i : number} #{number == 1 ? 'hour' : 'hours'}"
  end

  def possessive(name)
    "#{name}'s"
  end

  def readable_dates(text)
    text.gsub(ISO_DATE) do
      Date.new(Regexp.last_match(1).to_i, Regexp.last_match(2).to_i, Regexp.last_match(3).to_i).strftime("%b %-d, %Y")
    rescue Date::Error
      Regexp.last_match(0)
    end
  end
end
