# frozen_string_literal: true

class AddSafeEmployeeTermination < ActiveRecord::Migration[8.1]
  def up
    add_column :users, :terminated_at, :datetime
    add_column :users, :termination_effective_on, :date
    add_column :users, :termination_reason, :text
    add_reference :users, :terminated_by, foreign_key: { to_table: :users, on_delete: :nullify }

    orphan_count = select_value("SELECT COUNT(*) FROM time_entries WHERE user_id IS NULL").to_i
    if orphan_count.positive?
      raise ActiveRecord::MigrationError, "Cannot protect time-entry ownership while #{orphan_count} orphaned time entries exist"
    end

    change_column_null :time_entries, :user_id, false
  end

  def down
    change_column_null :time_entries, :user_id, true
    remove_reference :users, :terminated_by, foreign_key: true
    remove_column :users, :termination_reason
    remove_column :users, :termination_effective_on
    remove_column :users, :terminated_at
  end
end
