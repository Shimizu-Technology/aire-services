# frozen_string_literal: true

class UserTimeCategory < ApplicationRecord
  belongs_to :user
  belongs_to :time_category

  validates :time_category_id, uniqueness: { scope: :user_id }
  validates :hourly_rate_cents, numericality: { greater_than_or_equal_to: 0 }, allow_nil: true

  def effective_hourly_rate_cents
    hourly_rate_cents || time_category.hourly_rate_cents
  end

  def effective_hourly_rate
    cents = effective_hourly_rate_cents
    return nil if cents.blank?
    (cents.to_f / 100).round(2)
  end
end
