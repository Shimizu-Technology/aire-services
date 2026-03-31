# frozen_string_literal: true

class BackfillExistingTimeEntries < ActiveRecord::Migration[8.1]
  def up
    execute <<~SQL
      UPDATE time_entries
      SET approval_status = 'approved'
      WHERE entry_method = 'manual' AND approval_status IS NULL
    SQL
  end

  def down
    raise ActiveRecord::IrreversibleMigration
  end
end
