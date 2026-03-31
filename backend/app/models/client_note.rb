# frozen_string_literal: true

class ClientNote < ApplicationRecord
  belongs_to :client

  CATEGORIES = %w[general document question].freeze

  validates :content, presence: true, length: { maximum: 2000 }
  validates :category, inclusion: { in: CATEGORIES }

  scope :active, -> { where(deleted_at: nil) }
  scope :recent_first, -> { order(created_at: :desc) }

  def soft_delete!
    update!(deleted_at: Time.current)
  end

  def deleted?
    deleted_at.present?
  end
end
