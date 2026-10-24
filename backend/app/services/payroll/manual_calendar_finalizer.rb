# frozen_string_literal: true

module Payroll
  # The delegated cockpit command supplies the authenticated actor and reason.
  # Reuse period locking, immutable batch/outbox creation and retry audit paths.
  class ManualCalendarFinalizer < ScheduledCutoffFinalizer
    def initialize(period_id:, actor:, reason:)
      raise ArgumentError, "Manual calendar lock requires an actor and reason" if actor.nil? || reason.to_s.strip.empty?

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
      { actor: @actor, manual_calendar_lock: true }
    end

    def audit_actor
      @actor
    end

    def audit_metadata
      { reason: @reason }
    end
  end
end
