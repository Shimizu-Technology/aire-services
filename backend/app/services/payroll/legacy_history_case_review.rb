# frozen_string_literal: true

module Payroll
  class LegacyHistoryCaseReview
    def self.call
      LegacyPaidHistoryGuard.uncovered_entries.includes(:user, :time_entry_breaks).find_each { |entry| capture!(entry) }
    end

    def self.capture!(entry, actor: nil, reason: "Review uncovered pre-rollout hours against manual payment evidence")
      # Prefer the actual covering manual run. Older July work uses the first
      # release-history anchor; its opening event records that distinction.
      batches = LegacyPaidHistoryGuard.legacy_batches.distinct
      origin = batches.where("start_date <= ? AND end_date >= ?", entry.work_date, entry.work_date).first
      covering = origin.present?
      origin ||= batches.order(:start_date, :id).first!
      return if PayrollSettlementCase.active.exists?(source_time_entry_id: entry.id)
      return if PayrollSettlementCase.where(source_time_entry_id: entry.id, source_time_entry_version: entry.lock_version)
        .where(status: %w[not_payable settled]).exists?

      previous = PayrollSettlementCase.find_by(origin_payroll_batch: origin, source_time_entry_id: entry.id,
        source_time_entry_version: entry.lock_version, origin_reason: "legacy_history_review")
      if previous
        return previous unless previous.status == "superseded"

        SettlementCaseCoordinator.transition!(previous, status: "open", destination_kind: "unassigned",
          target_payroll_calendar_period: nil, target_external_pay_period_id: nil, included_payroll_batch: nil,
          resolved_at: nil, event_type: "rerouted", actor: actor,
          metadata: { requires_explicit_routing: true, reason: reason })
        return previous
      end
      PayrollSettlementCase.transaction(requires_new: true) do
        settlement_case = PayrollSettlementCase.create!(
          origin_payroll_batch: origin, source_time_entry_id: entry.id, source_time_entry_version: entry.lock_version,
          source_user_id: entry.user_id, source_user_uuid: entry.user.payroll_integration_uuid,
          origin_reason: "legacy_history_review", original_work_date: entry.work_date,
          held_total_hours: entry.hours.to_d.abs, action_due_on: BusinessDate.today,
          source_snapshot: { "id" => entry.id, "version" => entry.lock_version, "employee_name" => entry.user.full_name,
            "work_date" => entry.work_date.iso8601, "hours" => entry.hours.to_f }
        )
        settlement_case.payroll_settlement_case_events.create!(event_id: SecureRandom.uuid, event_type: "opened",
          to_status: "open", actor: actor, occurred_at: Time.current,
          metadata: { requires_explicit_routing: true, release_history_origin: !covering, reason: reason })
        settlement_case
      end
    rescue ActiveRecord::RecordNotUnique
      # An identical capture won the race; do not hide other failures.
      nil
    end
  end
end
