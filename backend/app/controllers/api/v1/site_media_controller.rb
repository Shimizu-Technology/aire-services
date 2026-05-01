# frozen_string_literal: true

module Api
  module V1
    class SiteMediaController < ApplicationController
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
          poster_url: attachment_url(item.poster),
          sort_order: item.sort_order,
          active: item.active,
          featured: item.featured,
          metadata: item.metadata
        }
      end

      def attachment_url(attachment)
        return nil unless attachment.attached?

        Rails.application.routes.url_helpers.rails_blob_url(attachment, host: request.base_url)
      end
    end
  end
end
