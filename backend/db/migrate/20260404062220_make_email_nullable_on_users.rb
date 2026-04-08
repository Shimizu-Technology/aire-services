# frozen_string_literal: true

class MakeEmailNullableOnUsers < ActiveRecord::Migration[8.1]
  def change
    change_column_null :users, :email, true
  end
end
