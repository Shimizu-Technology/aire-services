# frozen_string_literal: true

module Payroll
  # An allowlist projection of the same lifecycle used by manager reports.
  # Never serialize settlements, instrument references or payment reports here.
  class EmployeeEntryStatus
    LABELS = {
      "awaiting_approval" => "Not in payroll — awaiting approval",
      "not_payable" => "Not in payroll — time denied",
      "ready_for_cutoff" => "Approved — not paid yet",
      "finalized" => "In payroll — not paid yet",
      "imported" => "In payroll — not paid yet",
      "committed" => "In payroll — not paid yet",
      "payment_prepared" => "Check prepared — not paid yet",
      "payment_issued" => "Paid",
      "payment_failed" => "Payment needs attention",
      "payment_voided" => "Payment voided",
      "payment_cancelled" => "Payment cancelled",
      "partially_paid" => "Partly paid",
      "partially_prepared" => "Partly prepared — not fully paid",
      "partially_processed" => "Partly in payroll — not paid yet",
      "partially_allocated" => "Partly in payroll — not paid yet",
      "payment_attested_pending_evidence" => "Payment reported — details pending",
      "held" => "On hold — awaiting payroll",
      "payment_history_unavailable" => "Payment history unavailable"
    }.freeze

    # viewer: the signed-in user. When My Pay is enabled for them, their own
    # entries also get paycheck links and a plain cutoff explanation.
    def initialize(entries:, viewer: nil)
      @entries = Array(entries)
      @viewer = viewer
    end

    def call
      lifecycles = EntryLifecycleResolver.new(entries: @entries).call
      # The existing historical fence identifies older entries without inventing
      # a date boundary or treating a historical commit as issued payment.
      rollout = PayrollLockRollout.find_by(id: 1)
      untracked = !ConnectedPayrollMode.enabled? || rollout.nil?
      legacy_ids = @entries.empty? ? [] : LegacyPaidHistoryGuard.legacy_entry_ids(@entries.map(&:id))
      statuses = @entries.to_h do |entry|
        lifecycle = lifecycles.fetch(entry.id)
        status = lifecycle.fetch(:status)
        settlements = lifecycle.fetch(:settlements)
        historical = legacy_ids.include?(entry.id) || (rollout && entry.work_date < rollout.cutoff_enforcement_starts_on)
        # Older hours carried onto a current calendar payroll have a current
        # settlement to report; only history without one is uncertain.
        carried_forward = settlements.any? && settlements.all? do |row|
          !row[:legacy_processing] && calendar_batch_ids(lifecycles).include?(row[:batch_id])
        end
        open_shift = entry.status.in?(%w[clocked_in on_break])
        uncertain_history = (untracked || (historical && !carried_forward)) && (
          (settlements.empty? && status.in?(%w[ready_for_cutoff awaiting_approval])) ||
          (lifecycle.fetch(:paid_hours).zero? && status.in?(%w[finalized imported committed]))
        )
        if !open_shift && (uncertain_history || (status == "committed" && settlements.any? && settlements.all? { |row| row[:legacy_processing] }))
          status = "payment_history_unavailable"
        elsif lifecycle.fetch(:held_hours).positive? && settlements.empty? && status.in?(%w[ready_for_cutoff awaiting_approval])
          status = "held"
        end
        [ entry.id, {
          status: status,
          label: employee_label(entry, status, lifecycle, historical: historical),
          paid_hours: lifecycle.fetch(:paid_hours),
          held_hours: lifecycle.fetch(:held_hours)
        } ]
      end
      with_pay_context(statuses, lifecycles)
    end

    private

    # Batches run from the payroll calendar (connected payroll), as opposed to
    # the manually committed legacy batches LegacyPaidHistoryGuard fences.
    def calendar_batch_ids(lifecycles)
      @calendar_batch_ids ||= begin
        ids = lifecycles.values.flat_map { |lifecycle| lifecycle.fetch(:settlements).map { |row| row[:batch_id] } }.compact.uniq
        ids.empty? ? Set.new : PayrollBatch.where(public_id: ids)
          .where(id: PayrollCalendarPeriod.where.not(payroll_batch_id: nil).select(:payroll_batch_id))
          .pluck(:public_id).to_set
      end
    end

    def with_pay_context(statuses, lifecycles)
      return statuses unless @viewer && Setting.my_pay_enabled_for?(@viewer)

      own = @entries.select { |entry| entry.user_id == @viewer.id }
      context = EmployeeEntryPayContext.new(entries: own, lifecycles: lifecycles, statuses: statuses).call
      statuses.to_h { |id, status| [ id, status.merge(context.fetch(id, {})) ] }
    end

    def employee_label(entry, status, lifecycle, historical:)
      return "Shift in progress" if entry.status.in?(%w[clocked_in on_break])
      if status == "payment_attested_pending_evidence" && historical
        return "Historical payment reported — details unavailable"
      end
      return "Payroll correction recorded — no new payment" if lifecycle[:accounting_only]
      if lifecycle[:paid_hours].positive? && lifecycle[:paid_hours] >= entry.hours.to_f && status.in?(%w[finalized imported committed partially_paid partially_processed partially_allocated])
        return "Paid hours recorded — payroll update pending"
      end

      if status == "payment_history_unavailable" && !historical && lifecycle.fetch(:settlements).empty?
        return lifecycle.fetch(:status) == "ready_for_cutoff" ? "Approved — payment status not tracked yet" : "Payment status not tracked yet"
      end
      return LABELS.fetch(status) unless status == "held"
      return "On hold — needs manager approval" if entry.approval_status == "pending" || entry.overtime_status == "pending" || (entry.manual_entry? && entry.approval_status.nil?)

      LABELS.fetch(status)
    end
  end
end
