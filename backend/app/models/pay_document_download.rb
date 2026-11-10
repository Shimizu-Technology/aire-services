# frozen_string_literal: true

# One successful PDF download through a secure link, with where it came from.
class PayDocumentDownload < ApplicationRecord
  belongs_to :pay_document_delivery
  belongs_to :pay_document_item

  validates :user_agent, length: { maximum: 1_000 }
end
