# frozen_string_literal: true

class User < ApplicationRecord
  KIOSK_PIN_FORMAT = /\A\d{4,8}\z/
  KIOSK_MAX_FAILED_ATTEMPTS = 5
  KIOSK_LOCKOUT_DURATION = 15.minutes

  has_secure_password :kiosk_pin, validations: false

  has_many :audit_logs, dependent: :nullify
  has_many :time_entries, dependent: :nullify
  has_many :approved_time_entries, class_name: "TimeEntry", foreign_key: "approved_by_id", dependent: :nullify
  has_many :overtime_approved_time_entries, class_name: "TimeEntry", foreign_key: "overtime_approved_by_id", dependent: :nullify
  has_many :schedules, dependent: :nullify
  has_many :created_schedules, class_name: "Schedule", foreign_key: "created_by_id", dependent: :nullify
  has_many :time_period_locks, foreign_key: "locked_by_id", dependent: :nullify
  has_many :employee_pay_rates, dependent: :destroy
  has_many :user_time_categories, dependent: :destroy
  has_many :assigned_time_categories, through: :user_time_categories, source: :time_category

  attr_accessor :skip_kiosk_pin_presence_validation

  validates :clerk_id, presence: true, uniqueness: true
  validates :email, uniqueness: { case_sensitive: false }, allow_nil: true
  validates :email, format: { with: /\A[^@\s]+@[^@\s]+\.[^@\s]+\z/ }, allow_blank: true
  validates :is_active, inclusion: { in: [ true, false ] }
  validates :public_team_enabled, inclusion: { in: [ true, false ] }
  validates :role, inclusion: { in: %w[admin employee] }
  validate :approval_group_must_be_configured
  validate :public_team_profile_is_complete
  validates :kiosk_pin_lookup_hash, uniqueness: { message: "This PIN is already in use by another employee. Please choose a different PIN." }, allow_nil: true
  validate :kiosk_pin_format_if_present
  validate :staff_requires_pin_when_kiosk_enabled

  before_validation :set_default_kiosk_enabled
  before_validation :sync_kiosk_pin_lookup_hash

  scope :admins, -> { where(role: "admin") }
  scope :employees, -> { where(role: "employee") }
  scope :staff, -> { where(role: %w[admin employee]) }
  scope :kiosk_enabled, -> { staff.where(kiosk_enabled: true) }
  scope :public_team, -> {
    staff
      .where(is_active: true, public_team_enabled: true)
      .order(:public_team_sort_order, :last_name, :first_name, :id)
  }
  scope :for_approval_group, ->(approval_group) {
    case approval_group.to_s
    when ""
      all
    when "unassigned"
      where(approval_group: nil)
    else
      where(approval_group: approval_group)
    end
  }

  def self.kiosk_pin_lookup_hash_for(pin)
    return nil if pin.blank?

    secret = Rails.application.secret_key_base
    OpenSSL::HMAC.hexdigest("SHA256", secret, pin.to_s)
  end

  def self.find_kiosk_user_by_pin(pin)
    return nil if pin.blank?

    find_by(kiosk_pin_lookup_hash: kiosk_pin_lookup_hash_for(pin))
  end

  def full_name
    if first_name.present? || last_name.present?
      "#{first_name} #{last_name}".strip
    elsif email.present?
      email
    else
      "User ##{id}"
    end
  end

  def display_name
    if first_name.present?
      first_name
    elsif email.present?
      email.split("@").first
    else
      "User ##{id}"
    end
  end

  def admin?
    role == "admin"
  end

  def employee?
    role == "employee"
  end

  def staff?
    admin? || employee?
  end

  def approval_group_label
    Setting.approval_group_label_for(approval_group)
  end

  def pending_invite?
    clerk_id.blank? || clerk_id.start_with?("pending_")
  end

  def profile_name
    [ first_name, last_name ].map(&:presence).compact.join(" ").presence
  end

  def public_team_display_name
    public_team_name.presence || profile_name
  end

  def public_team_title_text
    public_team_title.to_s.strip.presence
  end

  def uses_clerk_profile?
    email.present?
  end

  def kiosk_only?
    !uses_clerk_profile?
  end

  def kiosk_locked?
    kiosk_locked_until.present? && kiosk_locked_until.future?
  end

  def kiosk_access_enabled?
    is_active? && staff? && kiosk_enabled? && kiosk_pin_digest.present? && !kiosk_locked?
  end

  def kiosk_pin_configured?
    kiosk_pin_digest.present?
  end

  def verify_kiosk_pin(pin)
    return false unless pin.present?
    return false unless is_active?
    return false unless staff?
    return false unless kiosk_enabled?
    return false if kiosk_locked?
    return false if kiosk_pin_lookup_hash.blank? || self.class.kiosk_pin_lookup_hash_for(pin) != kiosk_pin_lookup_hash

    authenticate_kiosk_pin(pin).present?
  end

  def register_kiosk_failure!
    attempts = kiosk_failed_attempts_count.to_i + 1
    attrs = { kiosk_failed_attempts_count: attempts }

    if attempts >= KIOSK_MAX_FAILED_ATTEMPTS
      attrs[:kiosk_locked_until] = KIOSK_LOCKOUT_DURATION.from_now
    end

    update!(attrs)
  end

  def clear_kiosk_failures!
    update!(kiosk_failed_attempts_count: 0, kiosk_locked_until: nil)
  end

  def rotate_kiosk_pin!(pin, enabled: true)
    self.kiosk_pin = pin
    self.kiosk_enabled = enabled
    self.kiosk_pin_last_rotated_at = Time.current
    self.kiosk_failed_attempts_count = 0
    self.kiosk_locked_until = nil
    save!
  end

  private

  def set_default_kiosk_enabled
    self.kiosk_enabled = false if kiosk_enabled.nil?
  end

  def sync_kiosk_pin_lookup_hash
    self.kiosk_pin_lookup_hash = self.class.kiosk_pin_lookup_hash_for(kiosk_pin) if kiosk_pin.present?
    self.kiosk_pin_lookup_hash = nil if kiosk_pin_digest.blank? && kiosk_pin.blank?
  end

  def kiosk_pin_format_if_present
    return if kiosk_pin.blank?
    return if kiosk_pin.match?(KIOSK_PIN_FORMAT)

    errors.add(:kiosk_pin, "must be 4 to 8 digits")
  end

  def staff_requires_pin_when_kiosk_enabled
    return unless staff?
    return unless kiosk_enabled?
    return if kiosk_pin_digest.present? || kiosk_pin.present? || skip_kiosk_pin_presence_validation

    errors.add(:kiosk_pin, "must be set when kiosk access is enabled")
  end

  def approval_group_must_be_configured
    return if approval_group.blank?
    return if Setting.approval_group_keys.include?(approval_group)

    errors.add(:approval_group, "must match a configured approval group")
  end

  def public_team_profile_is_complete
    return unless public_team_enabled?

    errors.add(:public_team_title, "is required when showing this user on the Team page") if public_team_title_text.blank?

    return if public_team_display_name.present?

    errors.add(:public_team_name, "is required when no first or last name is available")
  end
end
