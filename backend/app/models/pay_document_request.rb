# frozen_string_literal: true

# A worker's request for their own pay stub, made at the kiosk after PIN
# verification. It waits in the senders' list until someone fulfils it with a
# secure link or dismisses it. Only dates are stored, never amounts.
class PayDocumentRequest < ApplicationRecord
  SOURCES = %w[kiosk web].freeze
  SCOPES = %w[latest pay_date year].freeze
  STATUSES = %w[open fulfilled dismissed].freeze
  RECIPIENT_KINDS = %w[on_file typed].freeze

  belongs_to :user
  belongs_to :resolved_by, class_name: "User", optional: true
  has_many :pay_document_deliveries, dependent: :restrict_with_error

  validates :source, inclusion: { in: SOURCES }
  validates :document_kind, inclusion: { in: PayDocumentItem::KINDS }
  validates :scope, inclusion: { in: SCOPES }
  validates :status, inclusion: { in: STATUSES }
  validates :recipient_kind, inclusion: { in: RECIPIENT_KINDS }
  validates :recipient_email, presence: true, if: -> { recipient_kind == "typed" }
  validates :recipient_email, absence: true, if: -> { recipient_kind == "on_file" }
  validates :document_reference, presence: true, if: -> { scope == "pay_date" }
  validates :year, presence: true, numericality: { only_integer: true, greater_than: 2000, less_than: 2100 }, if: -> { scope == "year" }
  validates :resolution_note, length: { maximum: 500 }

  scope :open_requests, -> { where(status: "open") }
  scope :recent_first, -> { order(created_at: :desc, id: :desc) }

  def open?
    status == "open"
  end
end
