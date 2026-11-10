# frozen_string_literal: true

# One emailed secure link to a worker's pay documents. Only the SHA-256 digest
# of the link token is stored; the token itself exists only in the email.
# A link expires, can be revoked, and caps how often each document downloads.
class PayDocumentDelivery < ApplicationRecord
  ORIGINS = %w[sender self].freeze
  RECIPIENT_KINDS = %w[on_file typed].freeze
  EMAIL_STATUSES = %w[pending sent captured failed].freeze
  TOKEN_FORMAT = /\A[A-Za-z0-9_-]{43}\z/

  belongs_to :user
  belongs_to :sent_by, class_name: "User"
  belongs_to :revoked_by, class_name: "User", optional: true
  belongs_to :pay_document_request, optional: true
  has_many :pay_document_items, -> { order(:position, :id) }, dependent: :destroy, inverse_of: :pay_document_delivery
  has_many :pay_document_downloads, dependent: :destroy

  validates :origin, inclusion: { in: ORIGINS }
  validates :recipient_kind, inclusion: { in: RECIPIENT_KINDS }
  validates :email_status, inclusion: { in: EMAIL_STATUSES }
  validates :recipient_email, presence: true
  validates :token_digest, presence: true, uniqueness: true
  validates :expires_at, presence: true
  validates :max_downloads_per_document, numericality: { only_integer: true, greater_than: 0 }

  # Only a link whose email went out (or staging captured) can be used.
  DELIVERED_STATUSES = %w[sent captured].freeze

  scope :recent_first, -> { order(created_at: :desc, id: :desc) }
  # Links that would still work, or will once their email is recorded.
  scope :unrevoked_open, ->(now = Time.current) { where(revoked_at: nil).where.not(email_status: "failed").where("expires_at > ?", now) }

  def self.digest(token)
    Digest::SHA256.hexdigest(token.to_s)
  end

  def self.find_by_token(token)
    return nil unless TOKEN_FORMAT.match?(token.to_s)

    find_by(token_digest: digest(token))
  end

  def self.generate_token
    SecureRandom.urlsafe_base64(32)
  end

  def revoked?
    revoked_at.present?
  end

  def expired?(now = Time.current)
    expires_at <= now
  end

  # What the link page and the senders' list show for this link. "pending"
  # means the email hasn't been recorded as sent yet, so it can't be used.
  def state(now = Time.current)
    return "revoked" if revoked?
    return "failed" if email_status == "failed"
    return "pending" unless DELIVERED_STATUSES.include?(email_status)
    return "expired" if expired?(now)
    return "used_up" if pay_document_items.all? { |item| item.download_count >= max_downloads_per_document }

    "active"
  end

  def active?(now = Time.current)
    state(now) == "active"
  end
end
