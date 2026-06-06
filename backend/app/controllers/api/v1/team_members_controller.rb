# frozen_string_literal: true

module Api
  module V1
    class TeamMembersController < ApplicationController
      include AttachmentUrlHelpers

      def index
        members = User.public_team.with_attached_public_team_photo.filter_map do |user|
          name = user.public_team_display_name
          title = user.public_team_title_text
          next if name.blank? || title.blank?

          {
            id: user.id,
            name: name,
            title: title,
            photo_url: attachment_variant_url(user.public_team_photo, resize_to_fill: [ 720, 900 ]),
            photo_thumb_url: attachment_variant_url(user.public_team_photo, resize_to_fill: [ 320, 320 ]),
            photo_alt: user.public_team_photo.attached? ? "#{name}, #{title} at AIRE Services Guam" : nil
          }
        end

        render json: { team_members: members }
      end
    end
  end
end
