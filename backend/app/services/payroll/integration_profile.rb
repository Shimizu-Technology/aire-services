# frozen_string_literal: true

module Payroll
  class IntegrationProfile
    PROTOCOL = "shimizu_time_payroll"
    PROTOCOL_VERSION = "1.0"
    SOURCE_TYPE = "aire_services"
    SOURCE_INSTANCE_SETTING_KEY = "payroll_source_instance_id"
    UUID_PATTERN = /\A[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/i
    CAPABILITIES = %w[
      time_summary_v1
      finalized_batch_v2
      payroll_calendar_v2
      exact_line_receipts_v2
      payment_cancellation_v1
      employee_period_evidence_v1
      employee_directory
      payroll_cockpit
      account_linking
      manual_allocations
      payment_attestations
    ].freeze

    def self.call
      {
        protocol: PROTOCOL,
        protocol_version: PROTOCOL_VERSION,
        source_type: SOURCE_TYPE,
        source_instance_id: source_instance_id,
        capabilities: CAPABILITIES
      }
    end

    def self.source_instance_id
      existing = Setting.find_by(key: SOURCE_INSTANCE_SETTING_KEY)
      return validate_instance_id!(existing.value) if existing

      now = Time.current
      Setting.insert_all(
        [
          {
            key: SOURCE_INSTANCE_SETTING_KEY,
            value: SecureRandom.uuid,
            description: "Stable installation identity presented to connected payroll systems",
            created_at: now,
            updated_at: now
          }
        ],
        unique_by: :index_settings_on_key
      )

      validate_instance_id!(Setting.find_by!(key: SOURCE_INSTANCE_SETTING_KEY).value)
    end

    def self.validate_instance_id!(value)
      normalized = value.to_s.strip
      unless normalized.match?(UUID_PATTERN)
        raise "The payroll source instance identity is invalid; restore or deliberately rotate the saved installation identity"
      end

      normalized
    end

    private_class_method :validate_instance_id!
  end
end
