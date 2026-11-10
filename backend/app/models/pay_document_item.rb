# frozen_string_literal: true

# One document in a secure link. Today every item is a Cornerstone pay
# statement, referenced by its statement ID; year-end forms can be added as
# new kinds with their own source in PayDocuments::Sources.
class PayDocumentItem < ApplicationRecord
  KINDS = %w[pay_statement].freeze

  belongs_to :pay_document_delivery, inverse_of: :pay_document_items
  has_many :pay_document_downloads, dependent: :destroy

  validates :kind, inclusion: { in: KINDS }
  validates :reference, presence: true, uniqueness: { scope: [ :pay_document_delivery_id, :kind ] }
  validates :download_count, numericality: { only_integer: true, greater_than_or_equal_to: 0 }

  def downloads_left
    [ pay_document_delivery.max_downloads_per_document - download_count, 0 ].max
  end
end
