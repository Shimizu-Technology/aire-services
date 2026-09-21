# frozen_string_literal: true

require "digest"

# These administrators already have their own active accounts in both apps.
# Link only the two exact verified identities; never infer access from a name.
class ConnectVerifiedCornerstonePayrollAdmins < ActiveRecord::Migration[8.1]
  VERIFIED = {
    1 => "0261aa5794951774928830d60e323d5eac70fc1362233299d30d896a7026b21d",
    2 => "f880664df28a6a7c59bc16bed8534fe69abb1a66421296b1fa026411a5b9bac2"
  }.freeze

  def up
    users = User.where(id: VERIFIED.keys).index_by(&:id)
    # Non-production databases may not contain the AIRE client at all.
    return if users.empty?

    raise "Verified AIRE payroll administrators are missing" unless users.length == VERIFIED.length

    VERIFIED.each do |external_actor_id, expected_email_hash|
      user = users.fetch(external_actor_id)
      email = user.email.to_s.strip.downcase
      unless user.admin? && user.is_active? && user.personal_access_enabled? &&
             Digest::SHA256.hexdigest(email) == expected_email_hash
        raise "AIRE payroll administrator #{external_actor_id} changed; review account linking"
      end

      by_actor = PayrollAccountLink.find_by(
        external_system: PayrollAccountLink::EXTERNAL_SYSTEM,
        external_actor_id: external_actor_id.to_s
      )
      by_user = PayrollAccountLink.find_by(
        external_system: PayrollAccountLink::EXTERNAL_SYSTEM,
        user_id: user.id
      )
      if by_actor || by_user
        unless by_actor&.id == by_user&.id && by_actor.user_id == user.id && by_actor.connected?
          raise "Existing AIRE payroll account link differs from the verified administrator"
        end
        next
      end

      link = PayrollAccountLink.create!(
        user: user, external_system: PayrollAccountLink::EXTERNAL_SYSTEM,
        external_actor_id: external_actor_id.to_s, external_actor_email: email,
        active: true, linked_at: Time.current
      )
      AuditLog.record!(
        action: "payroll_account_link.verified_rollout_connected",
        actor: user, source: "integration", auditable: link,
        event_category: "security",
        metadata: { external_actor_id: external_actor_id.to_s, verified_email_match: true }
      )
    end
  end

  def down
    raise ActiveRecord::IrreversibleMigration, "Verified administrator links require a reviewed disconnection"
  end
end
