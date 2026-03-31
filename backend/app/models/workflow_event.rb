# frozen_string_literal: true

class WorkflowEvent < ApplicationRecord
  belongs_to :tax_return
  belongs_to :user, optional: true  # null for system-generated events

  validates :event_type, presence: true

  scope :recent, -> { order(created_at: :desc) }

  EVENT_TYPES = %w[
    status_changed
    assigned
    note_added
    document_uploaded
    document_deleted
    client_notified
    reviewed
    income_source_added
    income_source_updated
    income_source_removed
  ].freeze

  validates :event_type, inclusion: { in: EVENT_TYPES }

  def actor_name
    user&.full_name || "System"
  end
end
