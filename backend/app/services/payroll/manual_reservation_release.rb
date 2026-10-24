# frozen_string_literal: true

module Payroll
  # A release is a new routing decision, never permission to rewrite a frozen
  # batch or silently reuse a supplemental payroll/payment destination.
  class ManualReservationRelease
    class << self
      def record!(allocation:, actor:)
        return unless allocation.status == "voided"

        finalized = PayrollCalendarPeriod.where(status: "finalized")
        linked = finalized.where(payroll_batch_id: component_cases_for(allocation).select(:origin_payroll_batch_id))
        finalized.overlapping(allocation.work_date, allocation.work_date).or(linked).order(:cutoff_at, :id).each do |period|
          record_for_period!(period: period, batch: period.payroll_batch, allocations: [ allocation ], actor: actor)
        end
      end

      def record_for_period!(period:, batch:, actor: nil, allocations: nil)
        voided = PayrollManualAllocation.where(status: "voided")
        linked_entries = component_cases.where(origin_payroll_batch: batch).select(:source_time_entry_id)
        allocations ||= voided.where(work_date: period.start_date..period.end_date)
          .or(voided.where(time_entry_id: linked_entries)).to_a
        dated = allocations.select { |allocation| allocation.work_date.in?(period.start_date..period.end_date) }
        linked_ids = allocations.select { |allocation| component_cases_for(allocation).exists?(origin_payroll_batch: batch) }.map(&:id)
        return if dated.empty? && linked_ids.empty?

        PayrollSettlementCase.transaction do
          ActiveRecord::Base.connection.execute("SELECT pg_advisory_xact_lock(#{BatchFinalizer::ADVISORY_LOCK_KEY})")
          # Only dated reservations could suppress this original cutoff.
          # A moved replacement instead proves relevance through its exact
          # supplemental case; unrelated legacy history is never requested.
          historical = ManualAllocationLedger.active_at(period.cutoff_at,
            entry_ids: dated.map(&:time_entry_id), allocation_ids: dated.map(&:id)).index_by(&:id)
          allocations.each do |allocation|
            reserved = historical[allocation.id]
            next unless reserved || linked_ids.include?(allocation.id)
            next if release_recorded?(allocation)

            open_case!(period, batch, allocation, actor)
          end
        end
      end

      private

      def component_events
        PayrollSettlementCaseEvent.where(event_type: %w[committed settled])
          .where("metadata ? 'manual_allocation_component_ids'")
      end

      def component_cases
        PayrollSettlementCase.where(id: component_events.select(:payroll_settlement_case_id))
      end

      def component_cases_for(allocation)
        # The current destination can name another component's payroll or a
        # later operator route. Immutable component membership identifies the
        # source case regardless of issue order, destination, or work date.
        evidence = component_events.where("metadata @> ?::jsonb",
          { manual_allocation_component_ids: [ allocation.id.to_s ] }.to_json)
        PayrollSettlementCase.where(source_time_entry_id: allocation.time_entry_id,
          source_user_uuid: allocation.source_user_uuid, id: evidence.select(:payroll_settlement_case_id))
      end

      def release_recorded?(allocation)
        PayrollSettlementCaseEvent.joins(:payroll_settlement_case)
          .where(payroll_settlement_cases: { source_time_entry_id: allocation.time_entry_id })
          .where("metadata ->> 'released_manual_allocation_id' = ?", allocation.id.to_s).exists?
      end

      def open_case!(period, batch, allocation, actor)
        entry = allocation.time_entry
        represented = PayrollBatchEntry.where(source_time_entry_id: entry.id).sum(:total_hours).to_d
        reserved = PayrollManualAllocation.active.where(time_entry_id: entry.id).sum("regular_hours + overtime_hours").to_d
        remaining = [ entry.hours.to_d - represented - reserved, 0.to_d ].max
        settlement = PayrollSettlementCase.where(origin_payroll_batch: batch, source_time_entry_id: entry.id)
          .order(:id).lock.last
        settlement ||= PayrollSettlementCase.new(origin_payroll_batch: batch,
          source_time_entry_id: entry.id, source_user_id: allocation.user_id,
          source_user_uuid: allocation.source_user_uuid, origin_reason: "manual_reservation_released",
          original_work_date: allocation.work_date)
        event_type = settlement.persisted? ? "rerouted" : "opened"
        SettlementCaseCoordinator.transition!(settlement, status: "open", destination_kind: "unassigned",
          source_time_entry_version: entry.lock_version, held_total_hours: remaining,
          target_payroll_calendar_period: nil, target_external_pay_period_id: nil, included_payroll_batch: nil,
          resolved_at: nil, assigned_to: actor, action_due_on: period.pay_date,
          source_snapshot: { employee_name: entry.user.full_name, user_uuid: allocation.source_user_uuid,
            work_date: entry.work_date.iso8601, hours: entry.hours.to_f,
            released_manual_allocation_id: allocation.id.to_s }.deep_stringify_keys,
          resolution_note: "Manual payroll reservation released. Review current hours and choose a future payroll or mark not payable.",
          event_type: event_type, actor: actor,
          metadata: { reason: "manual_reservation_released", requires_explicit_routing: true,
            source_review_required: true, released_manual_allocation_id: allocation.id.to_s,
            released_hours: allocation.total_hours.to_s("F"), remaining_reserved_hours: reserved.to_s("F"),
            source_time_entry_version: entry.lock_version, origin_payroll_batch_id: batch.public_id })
      end
    end
  end
end
