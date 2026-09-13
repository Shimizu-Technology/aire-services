# frozen_string_literal: true

class PayrollIntegrationGrant < ApplicationRecord
  TOKEN_PREFIX = "aire_pay_"
  CAPABILITIES = %w[time_approval payroll_finalization].freeze
  DEFAULT_LIFETIME = 90.days
  MAX_LIFETIME = 1.year

  belongs_to :user

  attr_accessor :issued_token

  before_validation :generate_token_material, on: :create
  before_validation :set_default_expiry, on: :create

  validates :token_digest, presence: true, uniqueness: true, format: { with: /\A[0-9a-f]{64}\z/ }
  validates :token_hint, presence: true, length: { maximum: 24 }
  validates :active, inclusion: { in: [ true, false ] }
  validates :capabilities, presence: true
  validate :capabilities_are_supported
  validate :user_is_administrator
  validate :expiry_is_bounded

  scope :currently_active, -> { where(active: true).where("expires_at IS NULL OR expires_at > ?", Time.current) }

  def self.issue!(user:, capabilities:, expires_at: nil)
    create!(user: user, capabilities: Array(capabilities).map(&:to_s).uniq.sort, expires_at: expires_at)
  end

  def self.authenticate(raw_token)
    token = raw_token.to_s
    return if token.blank? || !token.start_with?(TOKEN_PREFIX)

    currently_active.find_by(token_digest: Digest::SHA256.hexdigest(token))
  end

  def allows?(capability)
    capabilities.include?(capability.to_s)
  end

  private

  def generate_token_material
    self.issued_token = "#{TOKEN_PREFIX}#{SecureRandom.urlsafe_base64(32)}"
    self.token_digest = Digest::SHA256.hexdigest(issued_token)
    self.token_hint = "#{issued_token.first(12)}…"
  end

  def capabilities_are_supported
    unsupported = Array(capabilities) - CAPABILITIES
    errors.add(:capabilities, "include unsupported values: #{unsupported.join(', ')}") if unsupported.any?
  end

  def user_is_administrator
    errors.add(:user, "must be an AIRE administrator") unless user&.admin?
  end

  def set_default_expiry
    self.expires_at ||= Time.current + DEFAULT_LIFETIME
  end

  def expiry_is_bounded
    return unless active?
    return if expires_at.present? && expires_at > Time.current && expires_at <= Time.current + MAX_LIFETIME

    errors.add(:expires_at, "must be in the future and no more than one year away")
  end
end
