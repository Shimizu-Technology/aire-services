# frozen_string_literal: true

class PayrollAccountLink < ApplicationRecord
  EXTERNAL_SYSTEM = "cornerstone_payroll"

  belongs_to :user

  validates :external_system, :external_actor_id, :linked_at, presence: true
  validates :external_actor_id, uniqueness: { scope: :external_system }
  validates :user_id, uniqueness: { scope: :external_system }
  validates :active, inclusion: { in: [ true, false ] }
  validates :external_actor_email,
            format: { with: /\A[^@\s]+@[^@\s]+\.[^@\s]+\z/ },
            allow_blank: true
  validate :user_can_manage_payroll

  scope :active, -> { where(active: true) }

  def connected?
    active? && user&.admin? && user.is_active? && user.personal_access_enabled?
  end

  def revoke!
    update!(active: false, revoked_at: Time.current)
  end

  private

  def user_can_manage_payroll
    return unless active?
    return if user.blank?
    return if user.admin? && user.is_active? && user.personal_access_enabled?

    errors.add(:user, "must be an active AIRE administrator with personal sign-in")
  end
end
