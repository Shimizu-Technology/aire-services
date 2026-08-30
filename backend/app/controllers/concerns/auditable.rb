# frozen_string_literal: true

module Auditable
  extend ActiveSupport::Concern

  SAFE_METHODS = %w[GET HEAD OPTIONS].freeze
  AUDITED_SUBJECT_VARIABLES = %i[@user @time_entry @leave_request @schedule @category @site_media].freeze
  FILTERED_PARAM_PATTERN = /(?:\A|_)(password|pin|token|secret|digest|hash|authorization|cookie|file|photo|upload)(?:_|\z)/i

  included do
    around_action :audit_request
  end

  private

  def audit_request
    yield
  ensure
    write_default_audit_event if performed?
  end

  def write_default_audit_event
    return if SAFE_METHODS.include?(request.request_method)
    return unless current_user
    return if Current.domain_audit_recorded

    record = audit_record_for_event
    snapshot = AuditRecordSnapshot.changes_for(record)
    AuditLog.record!(
      action: default_audit_action,
      auditable: record,
      actor: current_user,
      subject_type: default_subject_type(record),
      subject_id: record&.id || params[:id] || response_record_id || 0,
      subject_name: AuditRecordSnapshot.subject_name(record) || response_subject_name || controller_name.humanize,
      event_category: default_event_category,
      outcome: audit_outcome,
      metadata: {
        http_method: request.request_method,
        path: request.path,
        changed_fields: snapshot[:changed_fields].presence || safe_changed_fields,
        before_values: snapshot[:before_values].presence,
        after_values: snapshot[:after_values].presence,
        redacted_fields: snapshot[:redacted_fields].presence,
        response_status: response.status
      }.compact
    )
  rescue StandardError => e
    Rails.logger.warn("[Auditable] Failed to record #{controller_path}##{action_name}: #{e.class}: #{e.message}")
  end

  def audit_record_for_event
    return audit_record if respond_to?(:audit_record, true)

    AUDITED_SUBJECT_VARIABLES.filter_map do |name|
      next unless instance_variable_defined?(name)

      value = instance_variable_get(name)
      value if value.is_a?(ApplicationRecord)
    end.first
  end

  def default_audit_action
    area = controller_path.sub(%r{\Aapi/v1/}, "").tr("/", ".")
    "#{area}.#{action_name}"
  end

  def default_subject_type(record)
    record&.class&.name || controller_name.classify
  end

  def default_event_category
    path = controller_path
    return "users" if path.include?("users") || path.include?("auth")
    return "time_tracking" if path.include?("time_entries") || path.include?("kiosk")
    return "scheduling" if path.include?("schedule")
    return "leave" if path.include?("leave")
    return "reports" if path.include?("report")
    return "settings" if path.include?("settings") || path.include?("time_categories") || path.include?("pay_rates")
    return "content" if path.include?("media")

    "activity"
  end

  def audit_outcome
    return "succeeded" if response.successful? || response.redirect?
    return "denied" if response.status.in?([ 401, 403 ])

    "failed"
  end

  def safe_changed_fields
    flatten_changed_fields(params.to_unsafe_h).sort
  end

  def flatten_changed_fields(value, prefix = nil)
    return [] unless value.is_a?(Hash)

    value.flat_map do |key, nested|
      key = key.to_s
      next [] if key.match?(FILTERED_PARAM_PATTERN) || %w[controller action format id].include?(key)

      path = [ prefix, key ].compact.join(".")
      nested.is_a?(Hash) ? flatten_changed_fields(nested, path) : [ path ]
    end
  end

  def response_payload
    return {} unless response.media_type.to_s.end_with?("json")

    JSON.parse(response.body)
  rescue JSON::ParserError, TypeError
    {}
  end

  def response_record
    payload = response_payload
    return payload if payload.is_a?(Hash) && payload["id"].present?

    payload.values.find { |value| value.is_a?(Hash) && value["id"].present? } if payload.is_a?(Hash)
  end

  def response_record_id
    response_record&.fetch("id", nil)
  end

  def response_subject_name
    subject = response_record
    return if subject.blank?

    subject["full_name"] || subject["display_name"] || subject["name"] || subject["title"] || subject["email"]
  end
end
