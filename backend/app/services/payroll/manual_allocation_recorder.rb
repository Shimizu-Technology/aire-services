# frozen_string_literal: true

module Payroll
  class ManualAllocationRecorder
    class Error < StandardError; end

    def initialize(actor:)
      @actor = actor
    end

    # The caller holds the time-entry lock through CockpitCommand. A manual
    # allocation is a claim on exact source hours, never on a date range.
    def commit!(entry:, source_user_uuid:, regular_hours:, overtime_hours:,
                external_pay_period_id:, external_payroll_item_id:, pay_date:, reason:)
      validate_entry!(entry, source_user_uuid)
      regular = hours!(regular_hours)
      overtime = hours!(overtime_hours)
      raise Error, "Choose at least some hours to reconcile" unless (regular + overtime).positive?

      period_id = required_reference!(external_pay_period_id, "Cornerstone pay period")
      item_id = required_reference!(external_payroll_item_id, "Cornerstone payroll item")
      payment_date = date!(pay_date)
      explanation = required_reason!(reason)
      if PayrollManualAllocation.exists?(time_entry_id: entry.id, external_payroll_item_id: item_id)
        raise Error, "This Cornerstone payroll item is already linked to the AIRE time entry"
      end

      expected = weekly_split(entry)
      existing = PayrollManualAllocation.active.where(time_entry_id: entry.id)
      batch_rows = PayrollBatchEntry.where(source_time_entry_id: entry.id)
      if batch_rows.sum(:regular_hours).to_d + existing.sum(:regular_hours).to_d + regular > expected.fetch(:regular_hours) ||
         batch_rows.sum(:overtime_hours).to_d + existing.sum(:overtime_hours).to_d + overtime > expected.fetch(:overtime_hours)
        raise Error, "These hours exceed the AIRE regular or overtime hours still owed for this time entry"
      end

      allocation = PayrollManualAllocation.create!(
        time_entry: entry,
        user: entry.user,
        recorded_by: @actor,
        source_user_uuid: entry.user.payroll_integration_uuid,
        source_time_entry_version: entry.lock_version,
        work_date: entry.work_date,
        pay_date: payment_date,
        time_category_id: resolved_category_id(entry),
        regular_hours: regular,
        overtime_hours: overtime,
        external_pay_period_id: period_id,
        external_payroll_item_id: item_id,
        reason: explanation
      )
      record_event!(allocation, "committed", explanation)
      route_fully_allocated_cases!(entry, allocation)
      allocation
    end

    def issue!(allocation:, payment_method:, payment_reference:, occurred_at:, reason:)
      raise Error, "Only committed hours can be marked paid" unless allocation.status == "committed"

      method = required_reference!(payment_method, "Payment method")
      reference = required_reference!(payment_reference, "Check or payment reference")
      explanation = required_reason!(reason)
      issued_at = timestamp!(occurred_at)
      allocation.update!(
        status: "issued", payment_method: method, payment_reference: reference,
        issued_at: issued_at
      )
      record_event!(allocation, "issued", explanation,
                    payment_method: method, payment_reference: reference)
      close_fully_paid_cases!(allocation)
      allocation
    end

    def void!(allocation:, occurred_at:, reason:)
      raise Error, "These hours are already voided" if allocation.status == "voided"
      if allocation.status == "issued"
        raise Error, "Issued hours cannot be returned to payroll without verified nonpayment or a replacement-payment correction"
      end

      explanation = required_reason!(reason)
      voided_at = timestamp!(occurred_at)
      allocation.update!(status: "voided", voided_at: voided_at)
      record_event!(allocation, "voided", explanation,
                    payment_method: allocation.payment_method,
                    payment_reference: allocation.payment_reference)
      allocation
    end

    private

    def validate_entry!(entry, source_user_uuid)
      unless entry.user&.staff? && entry.user.payroll_integration_uuid == source_user_uuid.to_s.downcase
        raise Error, "AIRE employee identity changed; refresh before reconciling"
      end
      raise Error, "Complete and approve this AIRE time entry before reconciling" unless entry.counts_toward_hours?
    end

    def weekly_split(entry)
      entries = TimeEntry.countable.where(user_id: entry.user_id)
        .where(work_date: entry.work_date.beginning_of_week(:sunday)..entry.work_date.end_of_week(:sunday))
        .order(:work_date, :id)
        .to_a
      result = WeeklyOvertimeAllocator.call(entries).fetch(entry.id)
      {
        regular_hours: BigDecimal(result.fetch(:regular_hours).to_s).round(2),
        overtime_hours: entry.overtime_status == "approved" ? BigDecimal(result.fetch(:overtime_hours).to_s).round(2) : 0.to_d
      }
    end

    def resolved_category_id(entry)
      return entry.time_category_id if entry.time_category_id.present?

      categories = entry.user.assigned_time_categories.where(is_active: true).pluck(:id)
      raise Error, "Assign the AIRE time category before reconciling these hours" unless categories.one?

      categories.first
    end

    def hours!(value)
      raw = BigDecimal(value.to_s)
      hours = raw.round(2)
      raise Error, "Hours must be a non-negative number with at most two decimals" if hours.negative? || hours != raw

      hours
    rescue ArgumentError, TypeError
      raise Error, "Hours must be a non-negative number"
    end

    def required_reference!(value, label)
      text = value.to_s.strip
      raise Error, "#{label} is required" if text.blank? || text.length > 200

      text
    end

    def required_reason!(value)
      text = value.to_s.strip
      raise Error, "Enter a reconciliation reason of at least 10 characters" if text.length < 10

      text
    end

    def timestamp!(value)
      raise Error, "Use a timestamp with an explicit UTC offset" unless value.to_s.match?(/(?:Z|[+-]\d{2}:\d{2})\z/i)

      Time.iso8601(value.to_s)
    rescue ArgumentError
      raise Error, "Use a timestamp with an explicit UTC offset"
    end

    def date!(value)
      Date.iso8601(value.to_s)
    rescue Date::Error
      raise Error, "Pay date must use YYYY-MM-DD"
    end

    def route_fully_allocated_cases!(entry, allocation)
      total = PayrollManualAllocation.active.where(time_entry_id: entry.id).sum("regular_hours + overtime_hours").to_d
      PayrollSettlementCase.active.where(source_time_entry_id: entry.id).lock.each do |settlement_case|
        next if total < settlement_case.held_total_hours.to_d
        next if settlement_case.destination_kind == "supplemental" && settlement_case.target_external_pay_period_id == allocation.external_pay_period_id

        SettlementCaseRouter.new(
          settlement_case: settlement_case,
          destination_kind: "supplemental",
          target_external_pay_period_id: allocation.external_pay_period_id,
          action_due_on: allocation.pay_date.iso8601,
          assigned_to_id: @actor.id,
          reason: "Allocated to committed Cornerstone payroll item #{allocation.external_payroll_item_id}",
          actor: @actor
        ).call
      end
    end

    def close_fully_paid_cases!(allocation)
      paid = PayrollManualAllocation.where(time_entry_id: allocation.time_entry_id, status: "issued")
        .sum("regular_hours + overtime_hours").to_d
      PayrollSettlementCase.active.where(source_time_entry_id: allocation.time_entry_id).lock.each do |settlement_case|
        next if paid < settlement_case.held_total_hours.to_d

        SettlementCaseCoordinator.transition!(
          settlement_case,
          status: "settled",
          destination_kind: "supplemental",
          target_payroll_calendar_period: nil,
          target_external_pay_period_id: allocation.external_pay_period_id,
          included_payroll_batch: nil,
          resolved_at: allocation.issued_at,
          event_type: "settled",
          actor: @actor,
          occurred_at: Time.current,
          metadata: {
            external_pay_period_id: allocation.external_pay_period_id,
            external_payroll_item_id: allocation.external_payroll_item_id,
            payment_method: allocation.payment_method,
            payment_reference: allocation.payment_reference,
            physical_issued_at: allocation.issued_at.iso8601,
            reason: "Matched to an issued Cornerstone payment"
          }
        )
      end
    end

    def record_event!(allocation, event_type, reason, occurred_at: Time.current,
                      payment_method: nil, payment_reference: nil)
      allocation.payroll_manual_allocation_events.create!(
        actor: @actor, event_type: event_type, occurred_at: occurred_at,
        reason: reason, payment_method: payment_method, payment_reference: payment_reference
      )
    end
  end
end
