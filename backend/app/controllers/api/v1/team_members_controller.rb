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
            photo_url: attachment_variant_url(user.public_team_photo, resize_to_limit: [ 900, nil ]),
            photo_thumb_url: attachment_variant_url(user.public_team_photo, resize_to_limit: [ 480, nil ]),
            photo_alt: user.public_team_photo.attached? ? "#{name}, #{title} at AIRE Services Guam" : nil,
            photo_position_x: user.public_team_photo_position_x,
            photo_position_y: user.public_team_photo_position_y
          }
        end

        render json: { team_members: members }
      end
    end
  end
end
