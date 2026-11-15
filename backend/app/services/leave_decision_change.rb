# frozen_string_literal: true

# Leave is whole-day availability only: no time entries, payroll hours or mail
# are produced by a decision. Keep the employee lock before the request lock,
# matching approval and overlap validation.
class LeaveDecisionChange
  class Conflict < StandardError; end
  class Invalid < StandardError; end

  def initialize(request, actor)
    @request = request
    @actor = actor
  end

  def call!(version:, status:, reason:, undo: false)
    raise Invalid, "Only managers and admins can change leave decisions" unless @actor.can_approve_leave?
    raise Invalid, "Another manager or admin must change your own leave decision" if @request.user_id == @actor.id

    @request.user.with_lock(User::EMPLOYEE_ROW_LOCK) do
      @request.with_lock do
        raise Conflict, "This leave request changed. Refresh and try again." unless version.to_s == @request.lock_version.to_s
        raise Conflict, "Only approved or declined leave can be changed. Refresh and try again." unless @request.status.in?(%w[approved declined])

        if undo
          unless @request.initial_decision?
            raise Invalid, "Undo is only available after an initial approval or decline. Use Change decision."
          end
          unless @request.reviewed_by_id == @actor.id && @request.reviewed_at && Time.current < @request.reviewed_at + 15.minutes
            raise Invalid, "The 15-minute Undo window has ended or this was another person's decision. Use Change decision with a reason."
          end
          status = "pending"
        else
          raise Invalid, "Choose approved, declined or pending" unless status.in?(%w[approved declined pending])
          raise Invalid, "Choose a different decision" if status == @request.status
          reason = reason.to_s.strip
          raise Invalid, "Enter a short reason (1–500 characters)" unless reason.length.between?(1, 500)
        end

        if status.in?(%w[approved pending]) && (@request.user.terminated? || !@request.user.is_active?)
          raise Invalid, "This employee is inactive or terminated. Their time off cannot be approved or moved to waiting."
        end

        previous_status = @request.status
        attributes = { status: status, reviewed_by: status == "pending" ? nil : @actor,
                         reviewed_at: status == "pending" ? nil : Time.current }
        attributes[:review_note] = nil if undo
        @request.update!(attributes)
        AuditLog.record!(action: undo ? "leave_request.decision_undone" : "leave_request.decision_changed",
                         auditable: @request, actor: @actor, event_category: "leave",
                         metadata: { from: previous_status, to: status, reason: undo ? nil : reason,
                                     employee_id: @request.user_id, employee_name: @request.user.full_name })
      end
    end
  end
end
