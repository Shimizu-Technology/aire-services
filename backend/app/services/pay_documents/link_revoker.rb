# frozen_string_literal: true

module PayDocuments
  # Turns a secure link off immediately. Senders can revoke any link.
  class LinkRevoker
    TERMINATION_NOTE = "Closed automatically when the employee was terminated."

    def self.revoke!(delivery:, actor:)
      raise Error.new("You can't revoke pay stub links.", code: "not_permitted", status: :forbidden) unless actor&.is_active? && actor.can_send_pay_statements?

      revoke_locked!(delivery, actor: actor)
      delivery
    end

    # Termination: every link that still works, or would once emailed, is
    # turned off and each open request is closed, inside the caller's
    # transaction. The terminating owner or admin is the recorded actor.
    def self.revoke_for_termination!(worker:, actor:)
      PayDocumentDelivery.where(user: worker).unrevoked_open.find_each do |delivery|
        revoke_locked!(delivery, actor: actor, reason: "employee_terminated")
      end
      PayDocumentRequest.where(user: worker).open_requests.find_each do |request|
        request.with_lock do
          next unless request.open?

          request.update!(status: "dismissed", resolved_by: actor, resolved_at: Time.current, resolution_note: TERMINATION_NOTE)
          AuditLog.record!(action: "pay_documents.request_dismissed", auditable: request, actor: actor, subject_name: worker.full_name,
            event_category: "payroll", metadata: { request_id: request.id, target_user_id: worker.id, reason: "employee_terminated" })
        end
      end
    end

    def self.revoke_locked!(delivery, actor:, reason: nil)
      delivery.with_lock do
        next if delivery.revoked?

        delivery.update!(revoked_at: Time.current, revoked_by: actor)
        AuditLog.record!(
          action: "pay_documents.link_revoked",
          auditable: delivery,
          actor: actor,
          subject_name: delivery.user.full_name,
          event_category: "payroll",
          metadata: { delivery_id: delivery.id, target_user_id: delivery.user_id, origin: delivery.origin, reason: reason }.compact
        )
      end
    end
    private_class_method :revoke_locked!
  end
end
