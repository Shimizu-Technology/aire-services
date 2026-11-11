# frozen_string_literal: true

# One batch approval from the Approvals inbox (POST time_entries/review_batch).
# Its items record exactly which rows it changed, so an undo can prove nothing
# changed since and an Idempotency-Key replay returns the same batch.
class ReviewBatch < ApplicationRecord
  UNDO_WINDOW = 15.minutes

  belongs_to :actor, class_name: "User"
  belongs_to :undone_by, class_name: "User", optional: true
  has_many :review_batch_items, dependent: :destroy

  validates :public_id, :idempotency_key, :request_fingerprint, presence: true
  validates :entry_count, numericality: { only_integer: true, greater_than: 0 }

  before_validation { self.public_id ||= SecureRandom.uuid }

  def to_param = public_id

  def undo_expires_at
    created_at + UNDO_WINDOW
  end

  def undo_window_open?(now = Time.current)
    now < undo_expires_at
  end
end
