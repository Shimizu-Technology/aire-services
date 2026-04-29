# frozen_string_literal: true

class TimeCategory < ApplicationRecord
  has_many :time_entries, dependent: :nullify
  has_many :user_time_categories, dependent: :destroy
  has_many :assigned_users, through: :user_time_categories, source: :user
  has_many :employee_pay_rates, dependent: :restrict_with_error

  validates :name, presence: true
  validates :key, uniqueness: true, allow_nil: true
  validates :hourly_rate_cents, numericality: { greater_than_or_equal_to: 0 }, allow_nil: true

  scope :active, -> { where(is_active: true) }
  scope :with_usage_counts, lambda {
    left_joins(:time_entries, :employee_pay_rates)
      .select(
        "time_categories.*",
        "COUNT(DISTINCT time_entries.id) AS time_entries_count_value",
        "COUNT(DISTINCT employee_pay_rates.id) AS employee_pay_rates_count_value"
      )
      .group("time_categories.id")
  }

  def hourly_rate
    return nil if hourly_rate_cents.blank?

    (hourly_rate_cents.to_f / 100).round(2)
  end

  def deletable?
    time_entries_count.zero? && employee_pay_rates_count.zero?
  end

  def time_entries_count
    @time_entries_count ||= read_count_attribute(:time_entries_count_value) || time_entries.count
  end

  def employee_pay_rates_count
    @employee_pay_rates_count ||= read_count_attribute(:employee_pay_rates_count_value) || employee_pay_rates.count
  end

  private

  def read_count_attribute(name)
    value = self[name]
    return if value.nil?

    value.to_i
  end
end
