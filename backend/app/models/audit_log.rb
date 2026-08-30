# frozen_string_literal: true

class AuditLog < ApplicationRecord
  EVENT_CATEGORIES = %w[activity users security time_tracking approvals scheduling leave payroll reports settings content integration].freeze
  ACTOR_KINDS = %w[user system integration].freeze
  SOURCES = %w[web kiosk admin system integration legacy].freeze
  OUTCOMES = %w[succeeded failed denied deferred cancelled].freeze
  SENSITIVE_KEY_PATTERN = /(password|pin|token|secret|digest|hash|authorization|cookie|cipher|routing|account)/i

  belongs_to :auditable, polymorphic: true, optional: true
  belongs_to :user, optional: true

  validates :auditable_type, presence: true
  validates :auditable_id, presence: true
  validates :action, presence: true
  validates :occurred_at, presence: true
  validates :event_category, inclusion: { in: EVENT_CATEGORIES }
  validates :actor_kind, inclusion: { in: ACTOR_KINDS }
  validates :source, inclusion: { in: SOURCES }
  validates :outcome, inclusion: { in: OUTCOMES }

  scope :recent, -> { order(occurred_at: :desc, id: :desc) }
  scope :for_subject, ->(type, id) { where(auditable_type: type, auditable_id: id) }
  scope :for_type, ->(type) { where(auditable_type: type) }
  scope :for_action, ->(action) { where(action: action) }
  scope :by_user, ->(user) { where(user: user) }

  def readonly?
    persisted?
  end

  class << self
    def record!(action:, auditable: nil, actor: Current.user, subject_type: nil, subject_id: nil,
                subject_name: nil, event_category: "activity", actor_kind: nil, source: nil,
                outcome: "succeeded", changes: nil, metadata: {}, occurred_at: Time.current,
                correlation_id: nil, session_fingerprint: nil, mark_domain_recorded: true)
      resolved_type = subject_type || auditable&.class&.name
      resolved_id = subject_id || auditable&.id
      raise ArgumentError, "subject type and ID are required" if resolved_type.blank? || resolved_id.blank?

      entry = create!(
        auditable_type: resolved_type,
        auditable_id: resolved_id,
        action: action,
        user: actor,
        changes_made: sanitize(changes),
        metadata: sanitize(metadata || {}),
        event_category: event_category,
        occurred_at: occurred_at,
        actor_name: actor&.full_name,
        actor_email: actor&.email,
        actor_role: actor&.role,
        actor_kind: actor_kind || (actor ? "user" : "system"),
        source: source || (actor&.admin? ? "admin" : "web"),
        subject_name: subject_name || AuditRecordSnapshot.subject_name(auditable),
        outcome: outcome,
        request_id: Current.request_id,
        ip_address: Current.ip_address,
        user_agent: Current.user_agent,
        correlation_id: correlation_id,
        session_fingerprint: session_fingerprint
      )
      Current.domain_audit_recorded = true if mark_domain_recorded
      entry
    end

    def record_security_event!(action:, actor: Current.user, outcome:, metadata: {}, subject_name: nil)
      record!(
        action: action,
        actor: actor,
        subject_type: "Authentication",
        subject_id: actor&.id || 0,
        subject_name: subject_name || actor&.full_name || "Unknown visitor",
        event_category: "security",
        actor_kind: actor ? "user" : "system",
        source: "web",
        outcome: outcome,
        metadata: metadata,
        mark_domain_recorded: false
      )
    rescue StandardError => e
      Rails.logger.warn("Security audit failed for #{action}: #{e.class}: #{e.message}")
      nil
    end

    def record_sign_in_once!(actor:, session_fingerprint:)
      return if session_fingerprint.blank?

      record!(
        action: "auth.signed_in",
        actor: actor,
        auditable: actor,
        event_category: "security",
        outcome: "succeeded",
        session_fingerprint: session_fingerprint,
        mark_domain_recorded: false
      )
    rescue ActiveRecord::RecordNotUnique
      nil
    end

    # Backwards-compatible bridge for older call sites while events are migrated.
    def log(auditable:, action:, user: nil, changes_made: nil, metadata: nil)
      namespaced_action = action.include?(".") ? action : "#{auditable.class.name.underscore}.#{action}"
      record!(
        auditable: auditable,
        action: namespaced_action,
        actor: user,
        changes: changes_made,
        metadata: metadata.is_a?(Hash) ? metadata : { message: metadata }.compact,
        event_category: category_for(auditable)
      )
    end

    private

    def category_for(record)
      case record
      when User then "users"
      when TimeEntry then "time_tracking"
      when LeaveRequest then "leave"
      when Schedule then "scheduling"
      when ReportExport then "reports"
      when Setting, TimeCategory, EmployeePayRate then "settings"
      when SiteMedia then "content"
      else "activity"
      end
    end

    def sanitize(value)
      case value
      when Hash
        value.each_with_object({}) do |(key, item), result|
          result[key] = key.to_s.match?(SENSITIVE_KEY_PATTERN) ? "[REDACTED]" : sanitize(item)
        end
      when Array
        value.map { |item| sanitize(item) }
      else
        value
      end
    end
  end

  def description
    AuditLogPresenter.new(self).summary
  end
end
