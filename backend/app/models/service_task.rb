# frozen_string_literal: true

class ServiceTask < ApplicationRecord
  belongs_to :service_type
  has_many :time_entries, dependent: :nullify

  validates :name, presence: true
  validates :name, uniqueness: { scope: :service_type_id }

  scope :active, -> { where(is_active: true) }
  scope :ordered, -> { order(:position, :name) }

  # Set position for new records within the service type
  before_create :set_position

  private

  def set_position
    self.position ||= (service_type.service_tasks.maximum(:position) || 0) + 1
  end
end
