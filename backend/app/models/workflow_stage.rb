# frozen_string_literal: true

class WorkflowStage < ApplicationRecord
  SLUGS = {
    documents_pending: "documents_pending",
    in_preparation: "in_preparation",
    in_review: "in_review",
    ready_to_sign: "ready_to_sign",
    filing: "filing",
    ready_for_pickup: "ready_for_pickup",
    complete: "complete"
  }.freeze

  has_many :tax_returns, dependent: :nullify

  validates :name, presence: true
  validates :slug, presence: true, uniqueness: true
  validates :position, presence: true, numericality: { only_integer: true }

  scope :active, -> { where(is_active: true) }
  scope :ordered, -> { order(:position) }

  before_validation :generate_slug, if: -> { slug.blank? && name.present? }

  private

  def generate_slug
    self.slug = name.parameterize.underscore
  end
end
