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
  validates :role, inclusion: { in: %w[admin employee] }
  validates :kiosk_pin_lookup_hash, uniqueness: true, allow_nil: true
  validate :kiosk_pin_format_if_present
  validate :staff_requires_pin_when_kiosk_enabled

  before_validation :set_default_kiosk_enabled
  before_validation :sync_kiosk_pin_lookup_hash

  scope :admins, -> { where(role: "admin") }
  scope :employees, -> { where(role: "employee") }
  scope :staff, -> { where(role: %w[admin employee]) }
  scope :kiosk_enabled, -> { staff.where(kiosk_enabled: true) }

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

  def kiosk_locked?
    kiosk_locked_until.present? && kiosk_locked_until.future?
  end

  def kiosk_access_enabled?
    staff? && kiosk_enabled? && kiosk_pin_digest.present? && !kiosk_locked?
  end

  def kiosk_pin_configured?
    kiosk_pin_digest.present?
  end

  def verify_kiosk_pin(pin)
    return false unless pin.present?
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
end
