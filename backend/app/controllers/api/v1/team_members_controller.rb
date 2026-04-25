# frozen_string_literal: true

module Api
  module V1
    class TeamMembersController < ApplicationController
      def index
        members = User.public_team.filter_map do |user|
          name = user.public_team_display_name
          title = user.public_team_title_text
          next if name.blank? || title.blank?

          {
            id: user.id,
            name: name,
            title: title
          }
        end

        render json: { team_members: members }
      end
    end
  end
end
