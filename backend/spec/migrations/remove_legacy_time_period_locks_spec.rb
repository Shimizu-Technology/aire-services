# frozen_string_literal: true

require "rails_helper"
require Rails.root.join("db/migrate/20260831011000_remove_legacy_time_period_locks")

RSpec.describe RemoveLegacyTimePeriodLocks, type: :model do
  around do |example|
    ActiveRecord::Base.transaction(requires_new: true) do
      example.run
      raise ActiveRecord::Rollback
    end
  ensure
    TimeEntry.reset_column_information
  end

  it "archives legacy lock state in activity history and restores it on rollback" do
    migration = described_class.new
    migration.down
    TimeEntry.reset_column_information

    admin = create(:user, :admin)
    entry = create(:time_entry, user: create(:user, :employee))
    locked_at = Time.utc(2026, 5, 16, 1, 30)
    TimeEntry.where(id: entry.id).update_all(locked_at: locked_at)
    lock_id = ActiveRecord::Base.connection.select_value(<<~SQL).to_i
      INSERT INTO time_period_locks (
        start_date, end_date, locked_at, locked_by_id, reason, created_at, updated_at
      ) VALUES (
        '2026-05-01', '2026-05-15', '2026-05-16 01:30:00', #{admin.id},
        'Legacy payroll run', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      ) RETURNING id
    SQL

    migration.up
    TimeEntry.reset_column_information

    expect(ActiveRecord::Base.connection.data_source_exists?(:time_period_locks)).to be(false)
    expect(TimeEntry.column_names).not_to include("locked_at")
    lock_audit = AuditLog.find_by!(
      action: "legacy_time_period_lock.archived",
      auditable_type: "TimePeriodLock",
      auditable_id: lock_id
    )
    expect(lock_audit.metadata).to include(
      "start_date" => "2026-05-01",
      "end_date" => "2026-05-15",
      "reason" => "Legacy payroll run"
    )
    expect(AuditLog).to exist(
      action: "time_entry.legacy_lock_archived",
      auditable_type: "TimeEntry",
      auditable_id: entry.id
    )

    migration.down
    TimeEntry.reset_column_information

    restored_lock = ActiveRecord::Base.connection.select_one(
      "SELECT * FROM time_period_locks WHERE id = #{lock_id}"
    )
    expect(restored_lock).to include(
      "start_date" => Date.new(2026, 5, 1),
      "end_date" => Date.new(2026, 5, 15),
      "locked_by_id" => admin.id,
      "reason" => "Legacy payroll run"
    )
    expect(TimeEntry.find(entry.id).locked_at).to be_within(1.second).of(locked_at)
  end

  it "skips archived locks whose required locking user was deleted before rollback" do
    migration = described_class.new
    migration.down
    admin = create(:user, :admin)
    lock_id = ActiveRecord::Base.connection.select_value(<<~SQL).to_i
      INSERT INTO time_period_locks (
        start_date, end_date, locked_at, locked_by_id, reason, created_at, updated_at
      ) VALUES (
        '2026-05-01', '2026-05-15', '2026-05-16 01:30:00', #{admin.id},
        'Legacy payroll run', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      ) RETURNING id
    SQL

    migration.up
    admin.destroy!

    expect { migration.down }.not_to raise_error
    expect(ActiveRecord::Base.connection.select_value(
      "SELECT COUNT(*) FROM time_period_locks WHERE id = #{lock_id}"
    ).to_i).to eq(0)
  end
end
