# frozen_string_literal: true

module MediaUploadValidation
  extend ActiveSupport::Concern

  require "marcel"
  require "pathname"

  IMAGE_TYPES = %w[image/jpeg image/png image/webp image/avif image/gif].freeze
  VIDEO_TYPES = %w[video/mp4 video/webm video/quicktime].freeze
  MAX_IMAGE_SIZE = 15.megabytes
  MAX_VIDEO_SIZE = 250.megabytes

  class InvalidMediaUpload < StandardError
    attr_reader :messages

    def initialize(message)
      @messages = [ message ]
      super(message)
    end
  end

  private

  def validate_media_upload!(upload, media_type:, attachment_name: :file)
    return if upload.blank?
    unless upload.respond_to?(:tempfile)
      raise InvalidMediaUpload, "#{attachment_name} is not a valid upload"
    end

    allowed_types = attachment_name.to_sym == :poster ? IMAGE_TYPES : allowed_content_types_for(media_type)
    max_size = attachment_name.to_sym == :poster || media_type == "image" ? MAX_IMAGE_SIZE : MAX_VIDEO_SIZE
    detected_type = Marcel::MimeType.for(Pathname.new(upload.tempfile.path), name: upload.original_filename)

    unless allowed_types.include?(detected_type)
      raise InvalidMediaUpload, "#{attachment_name} must be a valid #{attachment_name.to_sym == :poster ? "image" : media_type} file"
    end

    if upload.size > max_size
      raise InvalidMediaUpload, "#{attachment_name} must be smaller than #{max_size / 1.megabyte}MB"
    end
  end

  def allowed_content_types_for(media_type)
    media_type == "video" ? VIDEO_TYPES : IMAGE_TYPES
  end
end
