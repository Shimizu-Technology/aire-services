# frozen_string_literal: true

module AttachmentUrlHelpers
  extend ActiveSupport::Concern

  private

  def attachment_url(attachment)
    return nil unless attachment&.attached?

    Rails.application.routes.url_helpers.rails_blob_url(attachment, host: request.base_url)
  end

  def attachment_variant_url(attachment, resize_to_fill: nil, resize_to_limit: nil)
    return nil unless attachment&.attached?
    return attachment_url(attachment) unless attachment.variable?

    transformation =
      if resize_to_fill.present?
        { resize_to_fill: resize_to_fill }
      elsif resize_to_limit.present?
        { resize_to_limit: resize_to_limit }
      end

    return attachment_url(attachment) unless transformation

    Rails.application.routes.url_helpers.rails_representation_url(
      attachment.variant(transformation),
      host: request.base_url
    )
  rescue ActiveStorage::InvariableError, ActiveStorage::UnpreviewableError
    attachment_url(attachment)
  end

  def image_variant_url(attachment, width:)
    return nil unless attachment&.attached?
    return nil unless attachment.variable?

    attachment_variant_url(attachment, resize_to_limit: [ width, nil ])
  end
end
