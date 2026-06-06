# frozen_string_literal: true

module AttachmentUrlHelpers
  extend ActiveSupport::Concern

  private

  def attachment_url(attachment)
    return nil unless attachment&.attached?

    Rails.application.routes.url_helpers.rails_blob_url(attachment, host: request.base_url)
  end

  def attachment_variant_url(attachment, resize_to_fill:)
    return nil unless attachment&.attached?
    return attachment_url(attachment) unless attachment.variable?

    Rails.application.routes.url_helpers.rails_representation_url(
      attachment.variant(resize_to_fill: resize_to_fill),
      host: request.base_url
    )
  rescue ActiveStorage::InvariableError, ActiveStorage::UnpreviewableError
    attachment_url(attachment)
  end
end
