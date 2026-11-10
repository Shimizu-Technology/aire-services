# frozen_string_literal: true

# Changes a person's role outside the Team page (the roles:assign rake task)
# and owns the audit record every role change writes, wherever it happens.
class RoleAssignment
  class Error < StandardError; end

  AUDIT_ACTION = "user.role_changed"
  LAST_OWNER_MESSAGE = "AIRE Ops must keep at least one active owner with personal sign-in"
  LAST_ADMINISTRATOR_MESSAGE = "AIRE Ops must keep at least one active admin with personal sign-in"

  Result = Struct.new(:user, :from, :to, :changed, keyword_init: true)

  class << self
    def audit!(user:, from:, to:, actor:, source: nil, metadata: {})
      AuditLog.record!(
        action: AUDIT_ACTION,
        auditable: user,
        actor: actor,
        actor_kind: actor ? nil : "system",
        source: source || (actor ? "admin" : "system"),
        event_category: "users",
        changes: { role: [ from, to ] },
        metadata: { target_user_id: user.id, target_name: user.full_name }.merge(metadata).compact
      )
    end

    # True when user is an owner who signs in, and no other active owner with
    # personal sign-in exists. Removing their role or access would leave AIRE
    # without anyone who can assign admin and owner.
    def last_active_owner?(user)
      user.owner? && user.is_active? && user.personal_access_enabled? &&
        !User.owners.where(is_active: true, personal_access_enabled: true).where.not(id: user.id).exists?
    end

    def last_active_administrator?(user)
      user.administrator? && user.is_active? && user.personal_access_enabled? &&
        !User.administrators.where(is_active: true, personal_access_enabled: true).where.not(id: user.id).exists?
    end
  end

  # Break-glass owner assignment exists for recovery when no active owner can
  # sign in (for example, the only owner left the company or lost access). It
  # needs an explicit reason and is called out in the audit row.
  def initialize(user_id:, role:, operator:, break_glass: false, reason: nil)
    @user_id = user_id
    @role = role.to_s
    @operator = operator.to_s.strip
    @break_glass = break_glass
    @reason = reason.to_s.strip.presence
  end

  def call
    raise Error, "ROLE must be one of #{User::ROLES.join(', ')}" unless User::ROLES.include?(role)
    raise Error, "Set OPERATOR to the name of the person running this task" if operator.blank?
    raise Error, "BREAK_GLASS requires a REASON" if break_glass && reason.blank?

    User.transaction do
      User.with_admin_access_lock do
        user = User.lock.find_by(id: user_id)
        raise Error, "No user with ID #{user_id}" unless user
        raise Error, "#{user.full_name} is not active" unless user.is_active?

        from = user.role
        next Result.new(user: user, from: from, to: role, changed: false) if from == role

        guard_owner_assignment!
        raise Error, LAST_OWNER_MESSAGE if self.class.last_active_owner?(user)
        raise Error, LAST_ADMINISTRATOR_MESSAGE if !User::ADMINISTRATOR_ROLES.include?(role) && self.class.last_active_administrator?(user)
        if User::SUPERVISOR_ROLES.include?(role) && !user.personal_access_enabled?
          raise Error, "#{user.full_name} needs personal sign-in before getting the #{role} role"
        end

        user.update!(role: role)
        self.class.audit!(
          user: user, from: from, to: role, actor: nil, source: "system",
          metadata: { operator: operator, break_glass: break_glass || nil, reason: reason, via: "roles:assign" }
        )
        Result.new(user: user, from: from, to: role, changed: true)
      end
    end
  end

  private

  attr_reader :user_id, :role, :operator, :break_glass, :reason

  def guard_owner_assignment!
    return unless role == "owner"
    return unless User.owners.where(is_active: true).exists?
    return if break_glass

    raise Error, "An active owner already exists. Owners assign owners from the Team page; use BREAK_GLASS=1 REASON=... only if no owner can sign in."
  end
end
