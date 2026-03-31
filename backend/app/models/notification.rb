# frozen_string_literal: true

class Notification < ApplicationRecord
  belongs_to :client
  belongs_to :tax_return, optional: true

  NOTIFICATION_TYPES = %w[email sms].freeze
  STATUSES = %w[pending sent failed].freeze
  TEMPLATES = %w[
    intake_confirmation
    documents_needed
    ready_to_sign
    return_filed
    ready_for_pickup
    status_changed
    document_uploaded_by_client
  ].freeze

  validates :notification_type, inclusion: { in: NOTIFICATION_TYPES }, allow_blank: true
  validates :status, inclusion: { in: STATUSES }
  validates :template, inclusion: { in: TEMPLATES }, allow_blank: true

  scope :pending, -> { where(status: "pending") }
  scope :sent, -> { where(status: "sent") }
  scope :failed, -> { where(status: "failed") }
  scope :recent, -> { order(created_at: :desc) }

  def mark_sent!
    update!(status: "sent", sent_at: Time.current)
  end

  def mark_failed!(error)
    update!(status: "failed", error_message: error)
  end
end
