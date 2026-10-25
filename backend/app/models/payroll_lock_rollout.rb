# frozen_string_literal: true

# One audited, configure-once decision for this AIRE installation, not a company.
class PayrollLockRollout < ApplicationRecord
  class NotConfiguredError < StandardError; end

  validates :configured_by, presence: true
  validates :reason, length: { minimum: 10 }
  validates :cutoff_enforcement_starts_on, presence: true
  validate :semimonthly_activation

  def self.installation
    find_by(id: 1) || raise(NotConfiguredError, "Configure the installation lock rollout first")
  end

  def self.configure!(starts_on:, actor:, reason:)
    boundary = Date.iso8601(starts_on.to_s)
    transaction do
      # Serialize with calendar publication so it cannot observe a partial setup.
      connection.execute("SELECT pg_advisory_xact_lock(#{Payroll::CalendarPeriodPublisher::ADVISORY_LOCK_KEY})")
      existing = find_by(id: 1)
      if existing && existing.cutoff_enforcement_starts_on != boundary
        raise ArgumentError, "Installation payroll lock rollout is immutable"
      end
      legacy = PayrollCalendarPeriod.where("start_date < ?", boundary)
        .where("lock_mode != 'manual' OR cutoff_enforcement_starts_on IS DISTINCT FROM ?", boundary)
      if legacy.exists?
        raise ArgumentError, "Legacy payroll calendars before #{boundary.iso8601} require explicit rollout fields (manual lock_mode and matching cutoff_enforcement_starts_on); stop deployment for reviewed resolution without rewriting history"
      end
      return existing if existing

      config = create!(id: 1, cutoff_enforcement_starts_on: boundary, configured_by: actor.to_s.strip, reason: reason.to_s.strip)
      AuditLog.record!(action: "payroll_lock_rollout.configured", actor: nil, source: "system", event_category: "payroll",
        auditable: config, metadata: { cutoff_enforcement_starts_on: boundary.iso8601, configured_by: config.configured_by, reason: config.reason })
      config
    end
  end

  def lock_mode_for(start_date)
    start_date < cutoff_enforcement_starts_on ? "manual" : "scheduled"
  end

  def readonly?
    persisted?
  end

  private

  def semimonthly_activation
    return if cutoff_enforcement_starts_on&.day.in?([ 1, 16 ])

    errors.add(:cutoff_enforcement_starts_on, "must be the 1st or 16th of a month")
  end
end
