# frozen_string_literal: true

# Adds the owner and manager roles. Nobody's role changes here; the lead
# assigns them after deploy with bin/rails roles:assign.
class AllowOwnerAndManagerRoles < ActiveRecord::Migration[8.1]
  def up
    remove_check_constraint :users, name: "check_valid_role"
    add_check_constraint :users, "role IN ('owner', 'admin', 'manager', 'employee')", name: "check_valid_role"
  end

  def down
    if select_value("SELECT 1 FROM users WHERE role IN ('owner', 'manager') LIMIT 1")
      raise ActiveRecord::IrreversibleMigration, "Move owners and managers back to admin or employee first"
    end

    remove_check_constraint :users, name: "check_valid_role"
    add_check_constraint :users, "role IN ('admin', 'employee')", name: "check_valid_role"
  end
end
