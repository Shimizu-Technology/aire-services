# frozen_string_literal: true

class PayrollTimeEntryRevision < ApplicationRecord
  validates :source_time_entry_id, :source_version, :source_user_id, :source_work_date, :recorded_at, presence: true
  validates :deleted, inclusion: { in: [ true, false ] }
  validate :snapshot_has_required_records

  def time_entry_state
    entry = TimeEntry.instantiate(snapshot.fetch("time_entry").slice(*TimeEntry.column_names))
    user = User.instantiate(snapshot.fetch("user").slice(*User.column_names))
    entry.association(:user).target = user

    category_attributes = snapshot["time_category"]
    if category_attributes
      entry.association(:time_category).target = TimeCategory.instantiate(
        category_attributes.slice(*TimeCategory.column_names)
      )
    else
      entry.association(:time_category).loaded!
    end
    entry
  end

  def readonly?
    persisted?
  end

  private

  def snapshot_has_required_records
    return if snapshot.is_a?(Hash) && snapshot["time_entry"].is_a?(Hash) && snapshot["user"].is_a?(Hash)

    errors.add(:snapshot, "must contain the time entry and employee state")
  end
end
