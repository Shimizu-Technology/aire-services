# frozen_string_literal: true

class AddCaseInsensitiveUniqueIndexToUserEmails < ActiveRecord::Migration[8.1]
  INDEX_NAME = "index_users_on_lower_email"

  def change
    add_index :users,
              "LOWER(email)",
              unique: true,
              where: "email IS NOT NULL AND BTRIM(email) <> ''",
              name: INDEX_NAME
  end
end
