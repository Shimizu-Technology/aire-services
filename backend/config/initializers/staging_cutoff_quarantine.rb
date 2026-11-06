# frozen_string_literal: true

# Kept separate from rollout/finalizer implementation to avoid mixing policies.
# A direct retry is held just like automatic discovery; no copied calendar is
# allowed to finalize just because its queue execution was recreated.
module StagingCutoffQuarantine
  def call
    return { period_id: period_id, status: "quarantined" } if StagingQuarantine.suppressed?("payroll_calendar_periods", period_id)
    super
  end
end
Rails.application.config.to_prepare do
  Payroll::ScheduledCutoffFinalizer.prepend(StagingCutoffQuarantine)
end
