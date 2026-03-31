# frozen_string_literal: true

class UpdateUserRoleDefault < ActiveRecord::Migration[8.0]
  def up
    change_column_default :users, :role, "employee"

    remove_check_constraint :users, name: "check_valid_role", if_exists: true
    add_check_constraint :users, "role IN ('admin', 'employee')", name: "check_valid_role"
  end

  def down
    change_column_default :users, :role, "client"

    remove_check_constraint :users, name: "check_valid_role", if_exists: true
    add_check_constraint :users, "role::text = ANY (ARRAY['admin'::character varying::text, 'employee'::character varying::text, 'client'::character varying::text])", name: "check_valid_role"
  end
end
