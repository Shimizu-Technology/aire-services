# frozen_string_literal: true

class Dependent < ApplicationRecord
  belongs_to :client

  validates :name, presence: true
  validates :months_lived_with_client, numericality: { only_integer: true, greater_than_or_equal_to: 0, less_than_or_equal_to: 12 }, allow_nil: true
end
