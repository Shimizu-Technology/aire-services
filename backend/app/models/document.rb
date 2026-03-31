# frozen_string_literal: true

class Document < ApplicationRecord
  belongs_to :tax_return
  belongs_to :uploaded_by, class_name: "User", optional: true  # null if client uploaded

  validates :filename, presence: true
  validates :s3_key, presence: true

  DOCUMENT_TYPES = %w[w2 1099 id prior_return other].freeze

  validates :document_type, inclusion: { in: DOCUMENT_TYPES }, allow_blank: true

  after_create :log_upload_event

  private

  def log_upload_event
    tax_return.workflow_events.create!(
      user: uploaded_by,
      event_type: "document_uploaded",
      new_value: filename,
      description: "Document uploaded: #{filename}"
    )
  end
end
