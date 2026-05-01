# frozen_string_literal: true

module Api
  module V1
    module Admin
      class SiteMediaController < BaseController
        include MediaUploadValidation

        before_action :authenticate_user!
        before_action :require_admin!
        before_action :set_site_media, only: [ :show, :update, :destroy ]
        rescue_from MediaUploadValidation::InvalidMediaUpload, with: :invalid_media_upload

        def index
          media = SiteMedia.ordered.with_attached_file.with_attached_poster
          render json: { site_media: media.map { |item| serialize_site_media(item) } }
        end

        def show
          render json: { site_media: serialize_site_media(@site_media) }
        end

        def create
          media = SiteMedia.new(site_media_params)
          media.uploaded_by = current_user
          attach_uploads(media)

          if media.save
            render json: { site_media: serialize_site_media(media.reload) }, status: :created
          else
            render json: { error: media.errors.full_messages.to_sentence, errors: media.errors.full_messages }, status: :unprocessable_entity
          end
        end

        def update
          @site_media.assign_attributes(site_media_params)
          replaced_blobs = attach_uploads(@site_media)

          if @site_media.save
            purge_replaced_blobs(replaced_blobs)
            render json: { site_media: serialize_site_media(@site_media.reload) }
          else
            render json: { error: @site_media.errors.full_messages.to_sentence, errors: @site_media.errors.full_messages }, status: :unprocessable_entity
          end
        end

        def destroy
          blobs = [ @site_media.file, @site_media.poster ].filter_map { |attachment| attachment.blob if attachment.attached? }
          @site_media.destroy!
          purge_replaced_blobs(blobs)
          head :no_content
        end

        private

        def set_site_media
          @site_media = SiteMedia.find(params[:id])
        end

        def site_media_params
          attributes = params.permit(
            :title,
            :alt_text,
            :caption,
            :placement,
            :media_type,
            :external_url,
            :sort_order,
            :active,
            :featured
          ).to_h.compact

          normalize_blank_optional_strings(attributes)
        end

        def normalize_blank_optional_strings(attributes)
          %w[alt_text caption external_url].each do |field|
            next unless attributes.key?(field) && attributes[field].is_a?(String)

            value = attributes[field].strip
            attributes[field] = value.presence
          end

          attributes
        end

        def attach_uploads(media)
          media_type = site_media_params.fetch("media_type", media.media_type)
          replaced_blobs = []

          if params[:file].present?
            validate_media_upload!(params[:file], media_type: media_type)
            replaced_blobs << media.file.blob if media.file.attached?
            media.file.attach(params[:file])
          end

          return replaced_blobs unless params[:poster].present?

          validate_media_upload!(params[:poster], media_type: media_type, attachment_name: :poster)
          replaced_blobs << media.poster.blob if media.poster.attached?
          media.poster.attach(params[:poster])
          replaced_blobs
        end

        def purge_replaced_blobs(blobs)
          blobs.compact.uniq.each(&:purge_later)
        end

        def invalid_media_upload(exception)
          render json: { error: exception.message, errors: exception.messages }, status: :unprocessable_entity
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
            metadata: item.metadata,
            uploaded_by_id: item.uploaded_by_id,
            created_at: item.created_at,
            updated_at: item.updated_at
          }
        end

        def attachment_url(attachment)
          return nil unless attachment.attached?

          Rails.application.routes.url_helpers.rails_blob_url(attachment, host: request.base_url)
        end
      end
    end
  end
end
