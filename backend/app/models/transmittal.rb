# frozen_string_literal: true

class Transmittal < ApplicationRecord
  belongs_to :client
  belongs_to :tax_return, optional: true
  belongs_to :created_by, class_name: "User"

  validates :created_by, presence: true

  STATUSES = %w[draft sent acknowledged].freeze

  validates :status, inclusion: { in: STATUSES }

  before_create :generate_transmittal_number

  scope :recent, -> { order(created_at: :desc) }

  private

  def generate_transmittal_number
    return if transmittal_number.present?

    prefix = "TR"
    year = Date.current.year
    sequence = Transmittal.where("transmittal_number LIKE ?", "#{prefix}-#{year}-%").count + 1
    self.transmittal_number = "#{prefix}-#{year}-#{sequence.to_s.rjust(4, '0')}"
  end
end
