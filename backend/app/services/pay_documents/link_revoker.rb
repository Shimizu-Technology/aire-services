# frozen_string_literal: true

module PayDocuments
  # Turns a secure link off immediately. Senders can revoke any link.
  class LinkRevoker
    def self.revoke!(delivery:, actor:)
      raise Error.new("You can't revoke pay stub links.", code: "not_permitted", status: :forbidden) unless actor&.is_active? && actor.can_send_pay_statements?

      delivery.with_lock do
        next delivery if delivery.revoked?

        delivery.update!(revoked_at: Time.current, revoked_by: actor)
        AuditLog.record!(
          action: "pay_documents.link_revoked",
          auditable: delivery,
          actor: actor,
          subject_name: delivery.user.full_name,
          event_category: "payroll",
          metadata: { delivery_id: delivery.id, target_user_id: delivery.user_id, origin: delivery.origin }
        )
      end
      delivery
    end
  end
end
