# frozen_string_literal: true

class SiteMedia < ApplicationRecord
  MEDIA_TYPES = %w[image video].freeze
  PLACEMENTS = %w[
    home_hero
    home_training
    home_tours
    home_video
    home_gallery
    programs_hero
    programs_training
    tour_bay
    tour_island
    tour_sunset
    programs_video
    discovery_hero
    team_hero
    careers_hero
    contact_feature
  ].freeze

  belongs_to :uploaded_by, class_name: "User", optional: true
  has_one_attached :file
  has_one_attached :poster

  validates :title, presence: true
  validates :placement, presence: true, inclusion: { in: PLACEMENTS }
  validates :media_type, presence: true, inclusion: { in: MEDIA_TYPES }
  validates :alt_text, presence: true, if: :image?
  validate :media_source_present

  scope :active, -> { where(active: true) }
  scope :ordered, -> { order(:placement, :sort_order, created_at: :desc) }
  scope :for_placement, ->(placement) { where(placement: placement).order(:sort_order, created_at: :desc) }

  def image?
    media_type == "image"
  end

  def video?
    media_type == "video"
  end

  private

  def media_source_present
    return if file.attached? || external_url.present?

    errors.add(:file, "or external URL is required")
  end
end
