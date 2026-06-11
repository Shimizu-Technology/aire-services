# frozen_string_literal: true

module Api
  module V1
    class SiteMediaController < ApplicationController
      include AttachmentUrlHelpers

      def index
        media = SiteMedia.active.ordered.with_attached_file.with_attached_poster
        placements = requested_placements
        media = media.where(placement: placements) if placements.any?

        items = media.map { |item| serialize_site_media(item) }
        render json: {
          site_media: items,
          by_placement: items.group_by { |item| item[:placement] }
        }
      end

      private

      def requested_placements
        raw = params[:placements].presence || params[:placement]
        Array(raw.to_s.split(",")).map(&:strip).filter_map do |placement|
          placement if SiteMedia::PLACEMENTS.include?(placement)
        end
      end

      def serialize_site_media(item)
        {
          id: item.id,
          title: item.title,
          alt_text: item.alt_text,
          caption: item.caption,
          placement: item.placement,
          media_type: item.media_type,
          external_url: item.external_url,
          file_url: attachment_url(item.file),
          file_thumb_url: image_variant_url(item.file, width: 480),
          file_card_url: image_variant_url(item.file, width: 900),
          file_hero_url: image_variant_url(item.file, width: 1800),
          poster_url: attachment_url(item.poster),
          poster_thumb_url: image_variant_url(item.poster, width: 480),
          poster_card_url: image_variant_url(item.poster, width: 900),
          poster_hero_url: image_variant_url(item.poster, width: 1800),
          sort_order: item.sort_order,
          active: item.active,
          featured: item.featured,
          metadata: item.metadata
        }
      end
    end
  end
end
