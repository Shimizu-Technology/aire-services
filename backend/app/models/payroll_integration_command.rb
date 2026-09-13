# frozen_string_literal: true

class PayrollIntegrationCommand < ApplicationRecord
  UUID_FORMAT = /\A[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/i

  belongs_to :actor, class_name: "User", optional: true

  validates :command_id, :action, :actor_id, :actor_payroll_integration_uuid, :target_type, :target_id,
            :request_checksum, :response_status, presence: true
  validates :actor_payroll_integration_uuid, format: { with: UUID_FORMAT }
  validates :command_id, uniqueness: true
  validates :command_id, format: { with: UUID_FORMAT }
  validates :request_checksum, format: { with: /\A[0-9a-f]{64}\z/ }
  validates :expected_version, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :response_status, numericality: { only_integer: true, in: 200..299 }
  validate :result_metadata_is_minimal

  def readonly?
    persisted?
  end

  private

  def result_metadata_is_minimal
    metadata = result_metadata.to_h.deep_stringify_keys
    forbidden = nested_keys(metadata) & %w[employee email name reason note time_entry payroll_period]
    errors.add(:result_metadata, "contains payroll or personal data") if forbidden.any?
    errors.add(:result_metadata, "is too large") if JSON.generate(metadata).bytesize > 2.kilobytes
  end

  def nested_keys(value)
    case value
    when Hash
      value.flat_map { |key, nested| [ key.to_s, *nested_keys(nested) ] }
    when Array
      value.flat_map { |nested| nested_keys(nested) }
    else
      []
    end
  end
end
