# frozen_string_literal: true

module Api
  module V1
    # Signed app delivery only: never redirect to storage or persist a derivative.
    # Public photo metadata is already gated by the required staging access gate.
    class StagingImagesController < ApplicationController
      MAX_IMAGE_BYTES = 20.megabytes

      def show
        return head :not_found unless StagingStoragePolicy.shared?
        blob = ActiveStorage::Blob.find_signed(params[:id], purpose: :staging_marked_image)
        return head :not_found unless blob && photo_attachment?(blob)
        unless %w[image/png image/jpeg image/webp].include?(blob.content_type) && blob.byte_size <= MAX_IMAGE_BYTES
          raise StagingOutboundPolicy::Blocked, "#{StagingOutboundPolicy::LABEL}: media format or size is disabled"
        end
        response.headers["Cache-Control"] = "no-store, private"
        response.headers["X-Content-Type-Options"] = "nosniff"
        bytes = +"".b
        blob.download do |chunk|
          if bytes.bytesize + chunk.bytesize > MAX_IMAGE_BYTES
            raise StagingOutboundPolicy::Blocked, "#{StagingOutboundPolicy::LABEL}: media size is disabled"
          end
          bytes << chunk
        end
        send_data(bytes, filename: "photo.png", type: "image/png", disposition: "inline")
      rescue ActiveStorage::FileNotFoundError
        head :not_found
      end

      private

      def photo_attachment?(blob)
        blob.attachments.where(record_type: "SiteMedia", name: %w[file poster]).exists? ||
          blob.attachments.where(record_type: "User", name: "public_team_photo").exists?
      end
    end
  end
end
