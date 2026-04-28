# frozen_string_literal: true

class AddStaffTitleToUsers < ActiveRecord::Migration[8.0]
  def change
    add_column :users, :staff_title, :string
  end
end
