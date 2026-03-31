# frozen_string_literal: true

class ServiceType < ApplicationRecord
  has_many :service_tasks, dependent: :destroy
  has_many :client_service_types, dependent: :destroy
  has_many :clients, through: :client_service_types
  has_many :time_entries, dependent: :nullify

  validates :name, presence: true, uniqueness: true

  scope :active, -> { where(is_active: true) }
  scope :ordered, -> { order(:position, :name) }

  # Set position for new records
  before_create :set_position

  private

  def set_position
    self.position ||= (ServiceType.maximum(:position) || 0) + 1
  end
end
