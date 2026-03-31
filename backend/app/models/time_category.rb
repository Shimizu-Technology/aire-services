# frozen_string_literal: true

class TimeCategory < ApplicationRecord
  has_many :time_entries, dependent: :nullify

  validates :name, presence: true
  validates :key, uniqueness: true, allow_nil: true
  validates :hourly_rate_cents, numericality: { greater_than_or_equal_to: 0 }, allow_nil: true

  scope :active, -> { where(is_active: true) }

  def hourly_rate
    return nil if hourly_rate_cents.blank?

    (hourly_rate_cents.to_f / 100).round(2)
  end
end
