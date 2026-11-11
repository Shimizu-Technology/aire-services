# frozen_string_literal: true

# One time entry a review batch approved: its version and review fields before
# and right after, so an undo can restore them only if nothing changed since.
class ReviewBatchItem < ApplicationRecord
  # The fields an approval changes and an undo puts back.
  REVIEW_FIELDS = %w[
    approval_status approved_by_id approved_at approval_note
    overtime_status overtime_approved_by_id overtime_approved_at overtime_note
  ].freeze

  belongs_to :review_batch
  belongs_to :time_entry, optional: true

  scope :active, -> { where(undone_at: nil) }

  def self.review_state(entry)
    REVIEW_FIELDS.index_with { |field| entry.public_send(field).as_json }
  end
end
