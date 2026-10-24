# frozen_string_literal: true

module Payroll
  class ManualAllocationRecorder
    class Error < StandardError; end
    class ClaimConflictError < Error; end

    def initialize(actor:)
      @actor = actor
    end

    # The caller holds the time-entry lock through CockpitCommand. A manual
    # allocation is a claim on exact source hours, never on a date range.
    def commit!(entry:, source_user_uuid:, regular_hours:, overtime_hours:,
                external_pay_period_id:, external_payroll_item_id:, pay_date:, reason:)
      with_reservation_lock do
        entry.lock!
        validate_entry!(entry, source_user_uuid)
        if PayrollPaymentAttestation.pending_evidence.exists?(time_entry_id: entry.id)
          raise Error, "This entry is held by an owner payment attestation; resolve its evidence before linking another paycheck"
        end
        create_allocation!(entry: entry, regular_hours: regular_hours, overtime_hours: overtime_hours,
          external_pay_period_id: external_pay_period_id, external_payroll_item_id: external_payroll_item_id,
          pay_date: pay_date, reason: reason)
      end
    end

    # Only the dedicated resolution transaction may replace this specific hold
    # with full issued coverage. Ordinary commit continues to reject holds.
    def commit_reported_payment!(attestation:, entry:, source_user_uuid:, regular_hours:, overtime_hours:,
                                 external_pay_period_id:, external_payroll_item_id:, pay_date:, reason:)
      with_reservation_lock do
        entry.lock!
        validate_entry!(entry, source_user_uuid)
        unless attestation.status == "pending_evidence" && attestation.time_entry_id == entry.id &&
            !attestation.source_changed? && hours!(regular_hours) + hours!(overtime_hours) == attestation.hours.to_d
          raise Error, "Resolve the unchanged complete payment report before linking its issued evidence"
        end
        if PayrollBatchEntry.exists?(source_time_entry_id: entry.id) || PayrollManualAllocation.active.exists?(time_entry_id: entry.id)
          raise Error, "Reported source hours already have payroll coverage; review before resolving"
        end
        create_allocation!(entry: entry, regular_hours: regular_hours, overtime_hours: overtime_hours,
          external_pay_period_id: external_pay_period_id, external_payroll_item_id: external_payroll_item_id,
          pay_date: pay_date, reason: reason)
      end
    end

    def issue!(allocation:, payment_method:, payment_reference:, payment_effective_on:, occurred_at:, reason:)
      raise Error, "Only committed hours can be marked paid" unless allocation.status == "committed"

      method = required_reference!(payment_method, "Payment method")
      reference = required_reference!(payment_reference, "Check or payment reference")
      cancelled = allocation.payroll_manual_allocation_events.where(event_type: "payment_cancelled").order(:id).last
      if allocation.payroll_manual_allocation_events.exists?(event_type: "payment_cancelled", payment_method: method, payment_reference: reference)
        raise Error, "A cancelled instrument cannot be issued again; use the replacement payment reference"
      end
      explanation = required_reason!(reason)
      issued_at = timestamp!(occurred_at)
      if cancelled && issued_at < cancelled.occurred_at
        raise Error, "Replacement issue cannot precede payment cancellation"
      end
      raise Error, "Payment cannot be recorded at a future time" if issued_at > Time.current

      paid_on = date!(payment_effective_on, label: "Payment date")
      if paid_on > issued_at.in_time_zone("Pacific/Guam").to_date
        raise Error, "Payment date cannot be after the time payment was recorded"
      end
      allocation.update!(
        status: "issued", payment_method: method, payment_reference: reference,
        issued_at: issued_at, payment_effective_on: paid_on
      )
      record_event!(allocation, "issued", explanation,
                    occurred_at: issued_at,
                    payment_method: method, payment_reference: reference,
                    payment_effective_on: paid_on)
      close_fully_paid_cases!(allocation)
      allocation
    end

    # Cancelling an instrument does not cancel the committed wage obligation.
    # The immutable issue event keeps the original evidence; only the active
    # projection returns to committed while the same hours remain reserved.
    def cancel_payment!(allocation:, payment_method:, payment_reference:, payment_effective_on:, occurred_at:, reason:, cancellation_evidence_reference:)
      required_reference!(cancellation_evidence_reference, "Cancellation evidence reference")
      raise Error, "Only active manual payments can be cancelled" unless allocation.status.in?(%w[committed issued])

      method = required_reference!(payment_method, "Original payment method")
      reference = required_reference!(payment_reference, "Original payment reference")
      paid_on = payment_effective_on.present? ? date!(payment_effective_on, label: "Original payment date") : nil
      if allocation.payroll_manual_allocation_events.exists?(event_type: "payment_cancelled", payment_method: method, payment_reference: reference)
        raise Error, "This payment instrument is already cancelled; refresh its acknowledgement"
      end
      if allocation.status == "issued" && !(allocation.payment_method == method && allocation.payment_reference == reference && allocation.payment_effective_on == paid_on)
        raise Error, "Original payment evidence changed; refresh before cancelling"
      end
      explanation = required_reason!(reason)
      cancelled_at = timestamp!(occurred_at)
      raise Error, "Payment cancellation cannot be recorded at a future time" if cancelled_at > Time.current
      if paid_on && paid_on > cancelled_at.in_time_zone("Pacific/Guam").to_date
        raise Error, "Original payment date cannot be after payment cancellation"
      end
      raise Error, "Payment cancellation cannot precede its issue" if allocation.issued_at && cancelled_at < allocation.issued_at

      # Even two committed cancellations at the same instant must fence an
      # in-flight issue command with a fresh optimistic version.
      allocation.payment_cancelled_at_will_change!
      allocation.update!(status: "committed", payment_method: nil, payment_reference: nil,
                         issued_at: nil, payment_effective_on: nil, payment_cancelled_at: cancelled_at)
      record_event!(allocation, "payment_cancelled", explanation, occurred_at: cancelled_at,
                    payment_method: method, payment_reference: reference, payment_effective_on: paid_on,
                    cancellation_evidence_reference: cancellation_evidence_reference.to_s.strip)
      reopen_cancelled_payment_cases!(allocation, method, reference, cancelled_at, explanation)
      allocation
    end

    def void!(allocation:, occurred_at:, reason:)
      with_reservation_lock do
        allocation.lock!
        return allocation if allocation.status == "voided"
        if allocation.status == "issued"
          raise Error, "Issued hours cannot be returned to payroll without verified nonpayment or a replacement-payment correction"
        end
        original_issue = allocation.payroll_manual_allocation_events.where(event_type: "issued").order(:id).last
        if original_issue && !allocation.payroll_manual_allocation_events.where(event_type: "payment_cancelled",
            payment_method: original_issue.payment_method, payment_reference: original_issue.payment_reference,
            payment_effective_on: original_issue.payment_effective_on).where("id > ?", original_issue.id)
            .where.not(cancellation_evidence_reference: [ nil, "" ]).exists?
          raise Error, "Previously issued hours need their exact verified cancellation before payroll can be voided"
        end

        explanation = required_reason!(reason)
        voided_at = timestamp!(occurred_at)
        allocation.update!(status: "voided", voided_at: voided_at)
        record_event!(allocation, "voided", explanation,
                      occurred_at: voided_at,
                      payment_method: allocation.payment_method,
                      payment_reference: allocation.payment_reference)
        ManualReservationRelease.record!(allocation: allocation, actor: @actor)
        allocation
      end
    end

    # A delayed cutoff may capture its original hold after payment resolution.
    # Preserve that exclusion while applying the verified current obligation.
    def settle_reported_payment_case!(attestation:, settlement_case:)
      allocation = attestation.resolved_manual_allocation
      original_issue = attestation.resolved_issued_event
      unless attestation.status == "resolved" && allocation && original_issue &&
          settlement_case.source_time_entry_id == allocation.time_entry_id &&
          settlement_case.source_user_uuid == allocation.source_user_uuid &&
          settlement_case.held_total_hours.to_d <= allocation.total_hours
        raise Error, "Settlement case does not match the resolved payment report"
      end
      issue = allocation.payroll_manual_allocation_events.where(event_type: "issued").order(:id).last!
      component = { allocation_id: allocation.id.to_s, issued_event_id: issue.id.to_s,
        external_pay_period_id: allocation.external_pay_period_id, external_payroll_item_id: allocation.external_payroll_item_id,
        regular_hours: allocation.regular_hours.to_s("F"), overtime_hours: allocation.overtime_hours.to_s("F"),
        payment_method: issue.payment_method, payment_reference: issue.payment_reference,
        payment_effective_on: issue.payment_effective_on.iso8601, physical_issued_at: issue.occurred_at.iso8601 }
      settle_manual_case!(settlement_case, allocation, [ component ], issue)
      unless allocation.status == "issued"
        cancellation = allocation.payroll_manual_allocation_events.where(event_type: "payment_cancelled",
          payment_method: issue.payment_method, payment_reference: issue.payment_reference,
          payment_effective_on: issue.payment_effective_on).where("id > ? AND occurred_at >= ?", issue.id, issue.occurred_at)
          .where.not(cancellation_evidence_reference: [ nil, "" ]).order(:id).last
        raise Error, "Resolved coverage needs verified cancellation before returning to review" unless allocation.status.in?(%w[committed voided]) && cancellation

        if allocation.status == "committed"
          reopen_cancelled_payment_cases!(allocation, cancellation.payment_method, cancellation.payment_reference,
            cancellation.occurred_at, cancellation.reason)
        else
          SettlementCaseCoordinator.transition!(settlement_case, status: "open", destination_kind: "unassigned",
            target_external_pay_period_id: nil, included_payroll_batch: nil, resolved_at: nil,
            event_type: "rerouted", actor: @actor, occurred_at: Time.current,
            metadata: { reason: "resolved_payment_cancelled_and_payroll_voided", requires_explicit_routing: true,
              payment_attestation_id: attestation.id.to_s, manual_allocation_id: allocation.id.to_s,
              issued_event_id: issue.id.to_s, cancellation_event_id: cancellation.id.to_s })
        end
      end
    end

    private

    def with_reservation_lock
      PayrollManualAllocation.transaction do
        connection = ActiveRecord::Base.connection
        connection.execute("SET LOCAL lock_timeout = '5s'")
        connection.execute("SELECT pg_advisory_xact_lock(#{BatchFinalizer::ADVISORY_LOCK_KEY})")
        yield
      end
    end

    def reject_pending_cutoff_claim!(entry, reservation_recorded_at = nil)
      now = ActiveRecord::Base.connection.select_value("SELECT clock_timestamp()")
      PayrollCalendarPeriod.where.not(status: "finalized").where("cutoff_at <= ?", now).order(:cutoff_at, :id).each do |period|
        next if reservation_recorded_at && period.cutoff_at >= reservation_recorded_at

        frozen_entry = TimeEntryRevisionLedger.new(cutoff_at: period.cutoff_at).entries_for_ids([ entry.id ]).first
        relevant = entry.work_date.in?(period.start_date..period.end_date) ||
          frozen_entry&.work_date&.in?(period.start_date..period.end_date) ||
          PayrollSettlementCase.active.exists?(target_payroll_calendar_period: period, source_time_entry_id: entry.id)
        next unless relevant

        result = BatchBuilder.new(start_date: period.start_date, end_date: period.end_date,
          cutoff_at: period.cutoff_at, calendar_period: period).call
        next unless result.fetch(:rows).any? { |row| row[:source_time_entry_id] == entry.id && row[:total_hours].positive? }

        raise ClaimConflictError, "Payroll cutoff #{period.external_pay_period_id} is due. Lock that cutoff and reconcile its frozen hours before committing this manual claim"
      end
    rescue TimeEntryRevisionLedger::CoverageError, ManualAllocationLedger::CoverageError, BatchBuilder::PolicyUnavailableError => e
      raise ClaimConflictError, "Payroll cutoff requires reconciliation before a manual claim: #{e.message}"
    end

    def create_allocation!(entry:, regular_hours:, overtime_hours:, external_pay_period_id:, external_payroll_item_id:, pay_date:, reason:)
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

      reject_pending_cutoff_claim!(entry)
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
      # The cutoff can pass while validating the weekly split or inserting.
      # Recheck only after the DB-stamped reservation exists: a post-cutoff
      # revision cannot cover that cutoff's payable obligation. Both the claim
      # and its revision roll back on conflict under the finalization lock.
      recorded_at = PayrollManualAllocationRevision.where(payroll_manual_allocation_id: allocation.id).order(:id).first!.recorded_at
      reject_pending_cutoff_claim!(entry, recorded_at)
      record_event!(allocation, "committed", explanation)
      route_fully_allocated_cases!(entry, allocation)
      allocation
    end

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
      period = PayrollCalendarPeriod.where("start_date <= ? AND end_date >= ?", entry.work_date, entry.work_date).order(:id).last
      if period && !WeeklyOvertimeAllocator.supported_policy?(period.overtime_policy)
        raise Error, "Published calendar overtime policy requires review before reconciling; finalized history needs an operator-reviewed correction"
      end
      result = WeeklyOvertimeAllocator.call(entries)[entry.id]
      raise Error, "This AIRE entry is not eligible for payroll; refresh its approval status" unless result
      {
        regular_hours: BigDecimal(result.fetch(:regular_hours).to_s).round(2),
        overtime_hours: entry.overtime_status.in?(%w[pending denied]) ? 0.to_d : BigDecimal(result.fetch(:overtime_hours).to_s).round(2)
      }
    end

    def resolved_category_id(entry)
      return entry.time_category_id if entry.time_category_id.present?

      categories = entry.user.assigned_time_categories.where(is_active: true).pluck(:id)
      # Historical source entries may have no category even though the exact
      # hours and issued check are verified. Keep the allocation uncategorized
      # when several assignments are possible rather than inventing a wage
      # classification or offering the already-paid hours again.
      categories.first if categories.one?
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

    def date!(value, label: "Pay date")
      Date.iso8601(value.to_s)
    rescue Date::Error
      raise Error, "#{label} must use YYYY-MM-DD"
    end

    def route_fully_allocated_cases!(entry, allocation)
      components = PayrollManualAllocation.active.where(time_entry_id: entry.id).order(:id)
      total = components.sum("regular_hours + overtime_hours").to_d
      PayrollSettlementCase.active.where(source_time_entry_id: entry.id).lock.each do |settlement_case|
        next if total < required_manual_coverage(settlement_case)

        unless settlement_case.destination_kind == "supplemental" && settlement_case.target_external_pay_period_id == allocation.external_pay_period_id
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
        # Bind the source case before issuance too: a later destination change
        # or a different component issued last cannot erase this membership.
        SettlementCaseCoordinator.transition!(settlement_case, status: settlement_case.status,
          event_type: "committed", actor: @actor,
          metadata: { manual_allocation_id: allocation.id.to_s,
            manual_allocation_component_ids: components.pluck(:id).map(&:to_s),
            reason: "Matched to committed Cornerstone manual components" })
      end
    end

    def required_manual_coverage(settlement_case)
      released = settlement_case.origin_reason == "manual_reservation_released" ||
        settlement_case.payroll_settlement_case_events.where("metadata ? 'released_manual_allocation_id'").exists?
      return settlement_case.held_total_hours.to_d unless released

      entry = TimeEntry.find(settlement_case.source_time_entry_id)
      represented = PayrollBatchEntry.where(source_time_entry_id: entry.id).sum(:total_hours).to_d
      # Retained payments belong to the whole unexported source obligation;
      # they cannot on their own close a smaller newly released component.
      [ entry.hours.to_d - represented, 0.to_d ].max
    end

    def close_fully_paid_cases!(allocation)
      components = issued_components(allocation)
      paid = components.sum { |component| component[:regular_hours].to_d + component[:overtime_hours].to_d }
      PayrollSettlementCase.active.where(source_time_entry_id: allocation.time_entry_id).lock.each do |settlement_case|
        next if paid < required_manual_coverage(settlement_case)

        issue = allocation.payroll_manual_allocation_events.where(event_type: "issued").order(:id).last!
        settle_manual_case!(settlement_case, allocation, components, issue)
      end
    end

    def settle_manual_case!(settlement_case, allocation, components, issue)
      SettlementCaseCoordinator.transition!(settlement_case,
        status: "settled", destination_kind: "supplemental", target_payroll_calendar_period: nil,
        target_external_pay_period_id: allocation.external_pay_period_id, included_payroll_batch: nil,
        resolved_at: issue.occurred_at, event_type: "settled", actor: issue.actor, occurred_at: Time.current,
        metadata: { external_pay_period_id: allocation.external_pay_period_id,
          external_payroll_item_id: allocation.external_payroll_item_id,
          payment_method: issue.payment_method, payment_reference: issue.payment_reference,
          physical_issued_at: issue.occurred_at.iso8601,
          manual_allocation_component_ids: components.map { |component| component[:allocation_id] },
          manual_allocation_components: components, reason: "Matched to an issued Cornerstone payment" })
    end

    def issued_components(allocation)
      PayrollManualAllocation.where(time_entry_id: allocation.time_entry_id,
        source_user_uuid: allocation.source_user_uuid, status: "issued").includes(:payroll_manual_allocation_events).order(:id).map do |row|
        issue = row.payroll_manual_allocation_events.select { |event| event.event_type == "issued" }.max_by(&:id)
        { allocation_id: row.id.to_s, issued_event_id: issue&.id&.to_s,
          external_pay_period_id: row.external_pay_period_id, external_payroll_item_id: row.external_payroll_item_id,
          regular_hours: row.regular_hours.to_s("F"), overtime_hours: row.overtime_hours.to_s("F"),
          payment_method: row.payment_method, payment_reference: row.payment_reference,
          payment_effective_on: row.payment_effective_on&.iso8601, physical_issued_at: row.issued_at&.iso8601 }
      end
    end

    def manual_settlement_evidence?(closing, allocation, method, reference)
      return false unless closing&.event_type == "settled" &&
        closing.metadata["reason"] == "Matched to an issued Cornerstone payment"

      # Verify the automatically generated closing footprint against the
      # final component's immutable issue event, including its recording time.
      final_component = PayrollManualAllocation.find_by(time_entry_id: allocation.time_entry_id,
        source_user_uuid: allocation.source_user_uuid, external_pay_period_id: closing.metadata["external_pay_period_id"].to_s,
        external_payroll_item_id: closing.metadata["external_payroll_item_id"].to_s)
      return false unless final_component
      verified_final_issue = final_component.payroll_manual_allocation_events.where(event_type: "issued", actor_id: closing.actor_id,
        payment_method: closing.metadata["payment_method"], payment_reference: closing.metadata["payment_reference"]).any? do |event|
        event.occurred_at.iso8601 == closing.metadata["physical_issued_at"] && event.created_at <= closing.created_at
      end
      return false unless verified_final_issue

      original_issue = allocation.payroll_manual_allocation_events.where(event_type: "issued", payment_method: method,
        payment_reference: reference).order(:id).last
      return false unless original_issue && original_issue.created_at <= closing.created_at && original_issue.occurred_at <= closing.occurred_at

      components = closing.metadata["manual_allocation_components"]
      return true if components.nil? # Legacy automatic closure, verified above.
      return false unless components.is_a?(Array)

      expected = { "allocation_id" => allocation.id.to_s, "issued_event_id" => original_issue.id.to_s,
        "external_pay_period_id" => allocation.external_pay_period_id, "external_payroll_item_id" => allocation.external_payroll_item_id,
        "regular_hours" => allocation.regular_hours.to_s("F"), "overtime_hours" => allocation.overtime_hours.to_s("F"),
        "payment_method" => method, "payment_reference" => reference,
        "payment_effective_on" => original_issue.payment_effective_on&.iso8601, "physical_issued_at" => original_issue.occurred_at.iso8601 }
      components.any? { |component| component.is_a?(Hash) && component.slice(*expected.keys) == expected }
    end

    def reopen_cancelled_payment_cases!(allocation, method, reference, cancelled_at, reason)
      components = issued_components(allocation)
      remaining_paid = components.sum { |component| component[:regular_hours].to_d + component[:overtime_hours].to_d }
      PayrollSettlementCase.where(status: "settled", destination_kind: "supplemental",
                                  source_time_entry_id: allocation.time_entry_id, source_user_uuid: allocation.source_user_uuid).lock.each do |settlement_case|
        next if remaining_paid >= required_manual_coverage(settlement_case)
        closing = settlement_case.payroll_settlement_case_events.order(:id).last
        next unless manual_settlement_evidence?(closing, allocation, method, reference)

        SettlementCaseCoordinator.transition!(settlement_case, status: "in_payroll", resolved_at: nil,
          event_type: "payment_cancelled", actor: @actor, occurred_at: Time.current,
          metadata: { external_pay_period_id: allocation.external_pay_period_id,
                      external_payroll_item_id: allocation.external_payroll_item_id, payment_method: method,
                      payment_reference: reference, manual_allocation_id: allocation.id.to_s,
                      retained_manual_allocation_component_ids: components.map { |component| component[:allocation_id] },
                      retained_manual_allocation_components: components,
                      cancelled_component_committed_hours: allocation.total_hours.to_s("F"),
                      reason: reason, physical_cancelled_at: cancelled_at.iso8601, committed_hours_retained: true })
      end
    end

    def record_event!(allocation, event_type, reason, occurred_at: Time.current,
                      payment_method: nil, payment_reference: nil, payment_effective_on: nil, cancellation_evidence_reference: nil)
      allocation.payroll_manual_allocation_events.create!(
        actor: @actor, event_type: event_type, occurred_at: occurred_at,
        reason: reason, payment_method: payment_method, payment_reference: payment_reference,
        payment_effective_on: payment_effective_on, cancellation_evidence_reference: cancellation_evidence_reference
      )
    end
  end
end
