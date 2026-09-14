# frozen_string_literal: true

require "digest"
require "securerandom"
require "uri"

class PayrollAccountLinkSession < ApplicationRecord
  TOKEN_PREFIX = "aire_link_"
  LIFETIME = 10.minutes

  belongs_to :linked_user, class_name: "User", optional: true

  attr_accessor :issued_token

  before_validation :generate_token_material, on: :create
  before_validation :set_default_expiry, on: :create

  validates :token_digest, :external_system, :external_actor_id, :return_url, :expires_at, presence: true
  validates :token_digest, uniqueness: true, format: { with: /\A[0-9a-f]{64}\z/ }
  validates :external_actor_email,
            format: { with: /\A[^@\s]+@[^@\s]+\.[^@\s]+\z/ },
            allow_blank: true
  validate :return_url_is_safe

  def self.issue!(external_actor_id:, external_actor_email:, return_url:)
    create!(
      external_system: PayrollAccountLink::EXTERNAL_SYSTEM,
      external_actor_id: external_actor_id.to_s,
      external_actor_email: external_actor_email.to_s.downcase.presence,
      return_url: return_url
    )
  end

  def self.available_for_token(raw_token)
    token = raw_token.to_s
    return if token.blank? || !token.start_with?(TOKEN_PREFIX)

    find_by(token_digest: Digest::SHA256.hexdigest(token))&.then do |session|
      session if session.consumed_at.nil? && session.expires_at.future?
    end
  end

  def authorize!(user)
    with_lock do
      raise ActiveRecord::RecordInvalid, self unless valid?
      errors.add(:base, "This connection request has already been used") if consumed_at.present?
      errors.add(:base, "This connection request has expired") unless expires_at.future?
      unless user&.admin? && user.is_active? && user.personal_access_enabled?
        errors.add(:base, "An active AIRE administrator account is required")
      end
      raise ActiveRecord::RecordInvalid, self if errors.any?

      existing_actor_link = PayrollAccountLink.find_by(
        external_system: external_system,
        external_actor_id: external_actor_id
      )
      existing_user_link = PayrollAccountLink.find_by(external_system: external_system, user: user)
      if existing_actor_link && existing_actor_link.user_id != user.id
        errors.add(:base, "This Cornerstone account is already connected to another AIRE administrator")
      end
      if existing_user_link && existing_user_link.external_actor_id != external_actor_id
        errors.add(:base, "This AIRE administrator is already connected to another Cornerstone account")
      end
      raise ActiveRecord::RecordInvalid, self if errors.any?

      link = existing_actor_link || existing_user_link || PayrollAccountLink.new(
        external_system: external_system,
        external_actor_id: external_actor_id,
        user: user
      )
      link.assign_attributes(
        user: user,
        external_actor_email: external_actor_email,
        active: true,
        linked_at: Time.current,
        revoked_at: nil
      )
      link.save!
      update!(consumed_at: Time.current, linked_user: user)
      link
    end
  end

  private

  def generate_token_material
    self.issued_token = "#{TOKEN_PREFIX}#{SecureRandom.urlsafe_base64(32)}"
    self.token_digest = Digest::SHA256.hexdigest(issued_token)
  end

  def set_default_expiry
    self.expires_at ||= Time.current + LIFETIME
  end

  def return_url_is_safe
    uri = URI.parse(return_url.to_s)
    allowed_scheme = uri.scheme == "https" || (Rails.env.development? || Rails.env.test?) && uri.scheme == "http"
    errors.add(:return_url, "must be a secure HTTP URL") unless allowed_scheme && uri.host.present? && uri.userinfo.blank?
  rescue URI::InvalidURIError
    errors.add(:return_url, "must be a valid URL")
  end
end
