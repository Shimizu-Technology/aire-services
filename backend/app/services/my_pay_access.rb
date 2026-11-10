# frozen_string_literal: true

# Turns My Pay on or off for one person or for everyone, writing an audit row
# with the actor and before/after values. Both switches live on the Team page.
class MyPayAccess
  class NotPermitted < StandardError; end

  class << self
    def set_for_user!(user:, enabled:, actor:)
      authorize!(actor)

      User.transaction do
        user.lock!
        before = user.my_pay_enabled?
        next if before == enabled

        # Only this switch changes, so unrelated profile validations must not block it.
        user.update_columns(my_pay_enabled: enabled, updated_at: Time.current)
        AuditLog.record!(
          action: "user.my_pay_access_changed",
          auditable: user,
          actor: actor,
          event_category: "users",
          changes: { my_pay_enabled: [ before, enabled ] },
          metadata: { target_user_id: user.id, target_name: user.full_name }
        )
      end
      user
    end

    def set_for_all!(enabled:, actor:)
      authorize!(actor)

      Setting.transaction do
        before = Setting.lock.find_by(key: Setting::MY_PAY_FOR_ALL_KEY)&.value == "true"
        next if before == enabled

        setting = Setting.set(Setting::MY_PAY_FOR_ALL_KEY, enabled.to_s, description: "When true, every active staff member can see My Pay")
        AuditLog.record!(
          action: "setting.my_pay_everyone_updated",
          auditable: setting,
          actor: actor,
          event_category: "settings",
          changes: { my_pay_enabled_for_all: [ before, enabled ] },
          metadata: { enabled: enabled }
        )
      end
      enabled
    end

    private

    def authorize!(actor)
      raise NotPermitted, "Only owners and admins can change My Pay access" unless actor&.is_active? && actor.can_manage_my_pay_access?
    end
  end
end
