# frozen_string_literal: true

class EmployeePayRate < ApplicationRecord
  belongs_to :user
  belongs_to :time_category

  validates :hourly_rate_cents, presence: true, numericality: { greater_than_or_equal_to: 0 }
  validates :time_category_id, uniqueness: { scope: :user_id, message: "already has a pay rate for this user" }

  # Return rate as decimal dollars
  def hourly_rate
    hourly_rate_cents ? (hourly_rate_cents / 100.0) : nil
  end

  # Look up the effective rate for a user+category.
  # Returns employee override if present, otherwise category default.
  def self.effective_rate_cents(user_id, time_category_id)
    override = find_by(user_id: user_id, time_category_id: time_category_id)
    return override.hourly_rate_cents if override

    TimeCategory.find_by(id: time_category_id)&.hourly_rate_cents
  end

  def self.effective_rate(user_id, time_category_id)
    cents = effective_rate_cents(user_id, time_category_id)
    cents ? (cents / 100.0) : nil
  end
end
