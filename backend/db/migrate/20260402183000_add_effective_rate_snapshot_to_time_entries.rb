# frozen_string_literal: true

class AddEffectiveRateSnapshotToTimeEntries < ActiveRecord::Migration[8.0]
  class MigrationTimeEntry < ApplicationRecord
    self.table_name = "time_entries"
  end

  class MigrationEmployeePayRate < ApplicationRecord
    self.table_name = "employee_pay_rates"
  end

  class MigrationTimeCategory < ApplicationRecord
    self.table_name = "time_categories"
  end

  def up
    add_column :time_entries, :effective_rate_cents_snapshot, :integer

    MigrationTimeEntry.reset_column_information

    say_with_time "Backfilling effective rate snapshots for completed time entries" do
      MigrationTimeEntry.where(status: "completed").where.not(user_id: nil, time_category_id: nil).find_each do |entry|
        entry.update_columns(
          effective_rate_cents_snapshot: effective_rate_cents_for(entry.user_id, entry.time_category_id),
          updated_at: entry.updated_at
        )
      end
    end
  end

  def down
    remove_column :time_entries, :effective_rate_cents_snapshot
  end

  private

  def effective_rate_cents_for(user_id, time_category_id)
    MigrationEmployeePayRate.find_by(user_id: user_id, time_category_id: time_category_id)&.hourly_rate_cents ||
      MigrationTimeCategory.find_by(id: time_category_id)&.hourly_rate_cents
  end
end
