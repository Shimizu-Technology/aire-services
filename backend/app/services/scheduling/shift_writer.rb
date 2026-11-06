# frozen_string_literal: true

module Scheduling
  class ShiftWriter
    class LeaveConflict < StandardError
      attr_reader :availability

      def initialize(leave)
        @availability = leave.map { |row| { id: row.id, user_id: row.user_id, start_date: row.start_date.iso8601, end_date: row.end_date.iso8601 } }
        super("Approved leave overlaps this shift. Confirm the scheduling decision and add a reason to continue.")
      end
    end

    def self.call(schedule:, attributes:, actor:, acknowledge_leave_conflict: false, leave_conflict_reason: nil, acknowledged_leave_ids: [])
      Schedule.transaction do
        schedule.assign_attributes(attributes)
        # Leave creation/editing/approval use the same employee lock so the
        # availability check and saved scheduling decision agree at write time.
        user = User.find_by(id: schedule.user_id)
        unless user
          schedule.errors.add(:user_id, "must reference an existing user")
          raise ActiveRecord::RecordInvalid, schedule
        end
        user.with_lock do
          leave = LeaveRequest.where(user_id: user.id, status: "approved")
            .where("start_date <= ? AND end_date >= ?", schedule.work_date, schedule.work_date).order(:id).to_a
          reason = leave_conflict_reason.to_s.strip
          acknowledged = ActiveModel::Type::Boolean.new.cast(acknowledge_leave_conflict) &&
            Array(acknowledged_leave_ids).map(&:to_i).sort == leave.map(&:id).sort
          raise LeaveConflict.new(leave) if leave.any? && (!acknowledged || reason.blank? || reason.length > 1000)

          schedule.save!
          if leave.any?
            AuditLog.record!(
              action: "schedule.leave_conflict_acknowledged", auditable: schedule, actor: actor,
              event_category: "scheduling", changes: schedule.saved_changes,
              metadata: {
                reason: reason, work_date: schedule.work_date.iso8601,
                approved_leave: leave.map { |row| { id: row.id, start_date: row.start_date.iso8601, end_date: row.end_date.iso8601 } },
                leave_unchanged: true
              }
            )
          end
          schedule
        end
      end
    end
  end
end
