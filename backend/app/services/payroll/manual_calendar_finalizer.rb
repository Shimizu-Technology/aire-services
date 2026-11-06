# frozen_string_literal: true

module Payroll
  # The delegated cockpit command supplies the authenticated actor and reason.
  # Reuse period locking, immutable batch/outbox creation and retry audit paths.
  class ManualCalendarFinalizer < ScheduledCutoffFinalizer
    def initialize(period_id:, actor:, reason:)
      unless actor.is_a?(User) && actor.persisted? && reason.to_s.strip.present?
        raise ArgumentError, "Manual calendar lock requires a persisted actor and reason"
      end

      @actor = actor
      @reason = reason.to_s.strip
      super(period_id: period_id)
    end

    private

    def eligible_mode?(period)
      period.manual_lock?
    end

    def due?(period)
      period.status.in?(%w[scheduled failed])
    end

    def batch_options(_period)
      # BatchFinalizer chooses now only after locking the source revision ledger.
      { actor: @actor, manual_calendar_lock: true, calendar_lock_reason: @reason }
    end

    def audit_actor
      @actor
    end

    def audit_metadata
      { reason: @reason }
    end
  end
end
