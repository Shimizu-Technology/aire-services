# frozen_string_literal: true

class AddCompositeIndexesToTimeEntries < ActiveRecord::Migration[8.0]
  disable_ddl_transaction!

  def change
    add_index :time_entries, [ :user_id, :work_date, :entry_method ],
              name: "idx_time_entries_user_date_method",
              algorithm: :concurrently,
              if_not_exists: true

    add_index :time_entries, [ :user_id, :work_date ],
              name: "idx_time_entries_user_date",
              algorithm: :concurrently,
              if_not_exists: true
  end
end
