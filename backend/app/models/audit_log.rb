# frozen_string_literal: true

class AuditLog < ApplicationRecord
  belongs_to :auditable, polymorphic: true, optional: true
  belongs_to :user, optional: true

  validates :auditable_type, presence: true
  validates :auditable_id, presence: true
  validates :action, presence: true, inclusion: { in: %w[created updated deleted] }

  # Scopes
  scope :recent, -> { order(created_at: :desc) }
  scope :for_type, ->(type) { where(auditable_type: type) }
  scope :for_action, ->(action) { where(action: action) }
  scope :by_user, ->(user) { where(user: user) }

  # Class method to log an event
  def self.log(auditable:, action:, user: nil, changes_made: nil, metadata: nil)
    create!(
      auditable_type: auditable.class.name,
      auditable_id: auditable.id,
      action: action,
      user: user,
      changes_made: changes_made,
      metadata: metadata
    )
  end

  # Helper to get a human-readable description
  def description
    entity_name = case auditable_type
                  when "TimeEntry"
                    if auditable
                      "time entry (#{auditable.hours}h on #{auditable.work_date})"
                    else
                      "time entry ##{auditable_id}"
                    end
                  when "Client"
                    if auditable
                      "client #{auditable.full_name}"
                    else
                      "client ##{auditable_id}"
                    end
                  when "TaxReturn"
                    if auditable
                      "#{auditable.tax_year} tax return for #{auditable.client&.full_name}"
                    else
                      "tax return ##{auditable_id}"
                    end
                  when "DailyTask"
                    if auditable
                      "daily task \"#{auditable.title}\" (#{auditable.task_date})"
                    else
                      "daily task ##{auditable_id}"
                    end
                  else
                    "#{auditable_type.underscore.humanize.downcase} ##{auditable_id}"
                  end

    case action
    when "created"
      "Created #{entity_name}"
    when "updated"
      "Updated #{entity_name}"
    when "deleted"
      "Deleted #{entity_name}"
    else
      "#{action.capitalize} #{entity_name}"
    end
  end
end
