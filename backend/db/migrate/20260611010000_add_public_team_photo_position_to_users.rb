# frozen_string_literal: true

class AddPublicTeamPhotoPositionToUsers < ActiveRecord::Migration[8.0]
  def change
    add_column :users, :public_team_photo_position_x, :integer, null: false, default: 50
    add_column :users, :public_team_photo_position_y, :integer, null: false, default: 50

    add_check_constraint :users,
                         "public_team_photo_position_x >= 0 AND public_team_photo_position_x <= 100",
                         name: "check_public_team_photo_position_x_range"
    add_check_constraint :users,
                         "public_team_photo_position_y >= 0 AND public_team_photo_position_y <= 100",
                         name: "check_public_team_photo_position_y_range"
  end
end
