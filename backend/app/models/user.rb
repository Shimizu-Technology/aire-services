# frozen_string_literal: true

class User < ApplicationRecord
  KIOSK_PIN_FORMAT = /\A\d{4,8}\z/
  KIOSK_MAX_FAILED_ATTEMPTS = 5
  KIOSK_LOCKOUT_DURATION = 15.minutes

  belongs_to :client, optional: true

  has_secure_password :kiosk_pin, validations: false

  has_many :assigned_tax_returns, class_name: "TaxReturn", foreign_key: "assigned_to_id", dependent: :nullify
  has_many :reviewed_tax_returns, class_name: "TaxReturn", foreign_key: "reviewed_by_id", dependent: :nullify
  has_many :workflow_events, dependent: :nullify
  has_many :audit_logs, dependent: :nullify
  has_many :time_entries, dependent: :nullify
  has_many :approved_time_entries, class_name: "TimeEntry", foreign_key: "approved_by_id", dependent: :nullify
  has_many :overtime_approved_time_entries, class_name: "TimeEntry", foreign_key: "overtime_approved_by_id", dependent: :nullify
  has_many :schedules, dependent: :nullify
  has_many :created_schedules, class_name: "Schedule", foreign_key: "created_by_id", dependent: :nullify
  has_many :uploaded_documents, class_name: "Document", foreign_key: "uploaded_by_id", dependent: :nullify
  has_many :created_transmittals, class_name: "Transmittal", foreign_key: "created_by_id", dependent: :nullify
  has_many :time_period_locks, foreign_key: "locked_by_id", dependent: :nullify
  has_many :client_operation_assignments, foreign_key: "created_by_id", dependent: :nullify
  has_many :generated_operation_cycles, class_name: "OperationCycle", foreign_key: "generated_by_id", dependent: :nullify
  has_many :assigned_operation_tasks, class_name: "OperationTask", foreign_key: "assigned_to_id", dependent: :nullify
  has_many :completed_operation_tasks, class_name: "OperationTask", foreign_key: "completed_by_id", dependent: :nullify
  has_many :default_operation_template_tasks, class_name: "OperationTemplateTask", foreign_key: "default_assignee_id", dependent: :nullify
  has_many :created_operation_templates, class_name: "OperationTemplate", foreign_key: "created_by_id", dependent: :nullify
  has_many :assigned_daily_tasks, class_name: "DailyTask", foreign_key: "assigned_to_id", dependent: :nullify
  has_many :reviewed_daily_tasks, class_name: "DailyTask", foreign_key: "reviewed_by_id", dependent: :nullify
  has_many :created_daily_tasks, class_name: "DailyTask", foreign_key: "created_by_id", dependent: :nullify
  has_many :completed_daily_tasks, class_name: "DailyTask", foreign_key: "completed_by_id", dependent: :nullify
  has_many :status_changed_daily_tasks, class_name: "DailyTask", foreign_key: "status_changed_by_id", dependent: :nullify

  attr_accessor :skip_kiosk_pin_presence_validation

  validates :clerk_id, presence: true, uniqueness: true
  validates :email, presence: true
  validates :role, inclusion: { in: %w[admin employee client] }
  validates :kiosk_pin_lookup_hash, uniqueness: true, allow_nil: true
  validate :kiosk_pin_format_if_present
  validate :staff_requires_pin_when_kiosk_enabled

  before_validation :set_default_kiosk_enabled
  before_validation :sync_kiosk_pin_lookup_hash

  scope :admins, -> { where(role: "admin") }
  scope :employees, -> { where(role: "employee") }
  scope :clients, -> { where(role: "client") }
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
    else
      email
    end
  end

  # Short display name for UI (first name or email prefix)
  def display_name
    if first_name.present?
      first_name
    else
      email.split("@").first
    end
  end

  def admin?
    role == "admin"
  end

  def employee?
    role == "employee"
  end

  def client?
    role == "client"
  end

  def staff?
    admin? || employee?
  end

  def portal_active?
    client? && clerk_id.present? && !clerk_id.start_with?("pending_")
  end

  def portal_invite_pending?
    client? && clerk_id.present? && clerk_id.start_with?("pending_")
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
    self.kiosk_enabled = false if client?
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
