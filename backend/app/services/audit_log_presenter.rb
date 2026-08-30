# frozen_string_literal: true

class AuditLogPresenter
  SUBJECTLESS_ACTIONS = %w[
    auth.signed_in auth.sign_in_failed auth.access_denied authorization.admin_denied
    authorization.staff_denied kiosk.verified kiosk.verification_failed kiosk.unlocked audit_history.exported
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
    "time_entry.clocked_in" => "Clocked in for",
    "time_entry.clocked_out" => "Clocked out from",
    "leave_request.created" => "Submitted",
    "leave_request.approved" => "Approved",
    "leave_request.declined" => "Declined",
    "leave_request.cancelled" => "Cancelled",
    "user.created" => "Created",
    "user.updated" => "Updated",
    "user.deleted" => "Deleted",
    "user.invite_resent" => "Resent an invitation for",
    "user.kiosk_pin_reset" => "Reset kiosk access for",
    "report.exported" => "Exported",
    "payroll_batch.finalized" => "Finalized",
    "payroll_batch.exported" => "Exported",
    "payroll_batch.retrieved" => "Retrieved",
    "audit_history.exported" => "Exported activity history"
  }.freeze

  attr_reader :audit_log

  def initialize(audit_log)
    @audit_log = audit_log
  end

  def actor
    audit_log.actor_name.presence || audit_log.actor_email.presence || audit_log.actor_kind.to_s.humanize
  end

  def subject
    audit_log.subject_name.presence || "#{audit_log.auditable_type.underscore.humanize.downcase} ##{audit_log.auditable_id}"
  end

  def summary
    verb = VERBS[audit_log.action] || audit_log.action.tr("._", " ").humanize
    return "#{actor} #{verb.downcase}".squish if SUBJECTLESS_ACTIONS.include?(audit_log.action)

    "#{actor} #{verb.downcase} #{subject}".squish
  end
end
