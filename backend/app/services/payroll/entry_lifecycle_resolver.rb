# frozen_string_literal: true

module Payroll
  class EntryLifecycleResolver
    # The plain words from the glossary draft (DESIGN.md §5), pending Chels's
    # confirmation. frontend/src/lib/payrollTerms.ts LIFECYCLE_LABELS holds the
    # same words; spec/services/payroll/payroll_glossary_spec.rb checks they match.
    LABELS = {
      "awaiting_approval" => "Waiting for approval",
      "not_payable" => "Denied, won't be paid",
      "ready_for_cutoff" => "Approved, not locked yet",
      "finalized" => "Locked for payroll",
      "imported" => "Received by Payroll",
      "committed" => "In a payroll run",
      "payment_prepared" => "Check prepared",
      "payment_issued" => "Paid",
      "payment_failed" => "Payment problem",
      "payment_voided" => "Payment voided",
      "payment_cancelled" => "Payment cancelled",
      "partially_paid" => "Partly paid",
      "partially_prepared" => "Partly in payroll",
      "partially_processed" => "Partly in payroll",
      "partially_allocated" => "Partly in payroll",
      "payment_attested_pending_evidence" => "Paid outside payroll, details pending"
    }.freeze
    # Payroll run without the AIRE connection and recorded here (PayrollManualAllocation).
    MANUAL_PAYROLL_LABEL = "Payroll done outside the connection"

    def initialize(entries:, overtime_context_entries: nil, overtime_allocations: nil, weekly_overtime_reviews: nil)
      @entries = Array(entries).uniq(&:id)
      @overtime_context_entries = overtime_context_entries
      @overtime_allocations = overtime_allocations
      @provided_weekly_overtime_reviews = weekly_overtime_reviews
    end

    def call
      return {} if entries.empty?

      @weekly_overtime_reviews = @provided_weekly_overtime_reviews || WeeklyOvertimeReview.call(entries, context_entries: @overtime_context_entries, allocations: @overtime_allocations)

      rows_by_entry = PayrollBatchEntry.effective
        .includes(payroll_batch: :payroll_batch_processing_events)
        .where(source_time_entry_id: entry_ids)
        .to_a
        .group_by(&:source_time_entry_id)
      entry_events = PayrollEntryProcessingEvent.includes(:payroll_obligation_correction)
        .where(source_time_entry_id: entry_ids)
        .order(:occurred_at, :id)
        .to_a
        .group_by { |event| [ event.source_time_entry_id, event.payroll_batch_id ] }
      latest_exclusions = PayrollBatchExclusion
        .includes(:payroll_batch)
        .where(source_time_entry_id: entry_ids)
        .order(:source_time_entry_id, :id)
        .to_a
        .group_by(&:source_time_entry_id)
        .transform_values(&:last)
      manual_by_entry = PayrollManualAllocation
        .includes(:payroll_manual_allocation_events)
        .where(time_entry_id: entry_ids)
        .order(:id)
        .to_a
        .group_by(&:time_entry_id)
      attestations_by_entry = PayrollPaymentAttestation.pending_evidence.includes(:time_entry, :user)
        .where(time_entry_id: entry_ids)
        .index_by(&:time_entry_id)
      resolved_reports_by_entry = PayrollPaymentAttestation.where(status: "resolved").where(time_entry_id: entry_ids).index_by(&:time_entry_id)

      entries.each_with_object({}) do |entry, result|
        manual = manual_by_entry.fetch(entry.id, [])
        attestation = attestations_by_entry[entry.id]
        settlements = settlements_for(rows_by_entry.fetch(entry.id, []), entry_events)
        settlements.concat(manual.map { |allocation| manual_settlement(allocation) })
        settlements.sort_by! { |settlement| [ Time.iso8601(settlement.fetch(:occurred_at)), settlement.fetch(:batch_id) ] }
        current_status = attestation ? "payment_attested_pending_evidence" : status_for(entry, settlements, manual)
        latest_event = settlements.last&.fetch(:event, nil)
        latest_exclusion = latest_exclusions[entry.id]
        latest_payment = manual.select { |allocation| allocation.status == "issued" }
          .max_by { |allocation| [ allocation.issued_at, allocation.id ] }

        accounting = current_status == "committed" && settlements.last&.dig(:accounting_only)
        result[entry.id] = {
          status: current_status,
          label: accounting ? AccountingCorrectionReceipt::LABEL : LABELS.fetch(current_status),
          accounting_only: accounting ? true : nil,
          accounting_correction: accounting ? settlements.last&.dig(:accounting_correction) : nil,
          payment_method: latest_payment&.payment_method || latest_event&.payment_method,
          payment_reference: latest_payment&.payment_reference || latest_event&.payment_reference,
          payment_effective_on: latest_payment&.payment_effective_on&.iso8601 || latest_event&.metadata&.dig("payment_effective_on"),
          occurred_at: latest_event&.occurred_at&.iso8601 || settlements.last&.dig(:occurred_at),
          latest_excluded_batch_id: latest_exclusion&.payroll_batch&.public_id,
          manually_committed_hours: round_hours(manual.select { |row| row.status == "committed" }.sum(&:total_hours)),
          manually_paid_hours: round_hours(manual.select { |row| row.status == "issued" }.sum(&:total_hours)),
          payment_attested_hours: attestation && round_hours(attestation.hours),
          payment_attested_at: attestation&.attested_at&.iso8601,
          payment_attestation_source_changed: attestation&.source_changed?,
          resolved_payment_report: resolved_reports_by_entry[entry.id]&.then do |report|
            { id: report.id.to_s, attested_at: report.attested_at.iso8601, reason: report.reason,
              resolved_at: report.resolved_at.iso8601, resolution_reason: report.resolution_reason,
              manual_allocation_id: report.resolved_manual_allocation_id.to_s,
              issued_event_id: report.resolved_issued_event_id.to_s }
          end,
          paid_hours: round_hours(settlements.sum { |row| row.fetch(:paid_hours, row[:status] == "payment_issued" ? row[:total_hours] : 0) }),
          held_hours: current_status == "not_payable" ? 0.0 : held_hours(entry, settlements, attestation, latest_exclusion),
          settlements: settlements.map { |settlement| settlement.except(:event) }
        }.compact
      end
    end

    def self.summary(lifecycles)
      Array(lifecycles).each_with_object(Hash.new(0)) do |lifecycle, counts|
        counts[(lifecycle[:accounting_only] && lifecycle[:status] == "committed" ? "accounting_correction_committed" : lifecycle.fetch(:status))] += 1
      end.sort.to_h
    end

    private

    attr_reader :entries

    def entry_ids
      @entry_ids ||= entries.map(&:id)
    end

    def settlements_for(rows, entry_events)
      rows.group_by(&:payroll_batch).sort_by { |batch, _| [ batch.cutoff_at, batch.id ] }.map do |batch, batch_rows|
        events = entry_events.fetch([ batch_rows.first.source_time_entry_id, batch.id ], [])
        batch_processing = batch.processing_status
        processing = EntryProcessingSummary.new(
          rows: batch_rows,
          events: events,
          batch_processing: batch_processing
        ).call
        status = processing.fetch(:status)
        occurred_at = processing[:occurred_at] || batch.finalized_at.iso8601
        latest_event = PayrollEntryProcessingEvent.latest(events)

        {
          legacy_processing: processing[:external_system] == "cornerstone_payroll_manual",
          batch_id: batch.public_id,
          start_date: batch.start_date.iso8601,
          end_date: batch.end_date.iso8601,
          status: status,
          label: processing[:accounting_only] ? AccountingCorrectionReceipt::LABEL : LABELS.fetch(status, status.humanize),
          accounting_only: processing[:accounting_only],
          accounting_correction: processing[:accounting_only] && processing[:lines].one? && processing[:lines].first&.dig(:accounting_correction),
          accounting_correction_line_count: processing[:accounting_correction_line_count],
          accounting_correction_hours: processing[:accounting_correction_hours],
          occurred_at: occurred_at,
          source_kinds: batch_rows.map(&:source_kind).uniq.sort,
          total_hours: round_hours(batch_rows.sum(&:total_hours)),
          regular_hours: round_hours(batch_rows.sum(&:regular_hours)),
          overtime_hours: round_hours(batch_rows.sum(&:overtime_hours)),
          paid_hours: processing.fetch(:paid_hours),
          prepared_hours: processing.fetch(:prepared_hours),
          failed_hours: processing.fetch(:failed_hours),
          voided_hours: processing.fetch(:voided_hours),
          outstanding_hours: processing.fetch(:outstanding_hours),
          payable_lines: processing.fetch(:lines),
          external_pay_period_id: processing[:external_pay_period_id],
          external_payroll_item_id: processing[:external_payroll_item_id],
          payment_method: processing[:payment_method],
          payment_reference: processing[:payment_reference],
          payment_effective_on: latest_event&.metadata&.dig("payment_effective_on"),
          event: latest_event

        }.compact
      end
    end

    def manual_settlement(allocation)
      latest_event = allocation.payroll_manual_allocation_events.max_by(&:id)
      status = if allocation.status == "committed" && latest_event&.event_type == "payment_cancelled"
        "payment_cancelled"
      else
        { "committed" => "committed", "issued" => "payment_issued", "voided" => "payment_voided" }.fetch(allocation.status)
      end
      {
        batch_id: "manual-#{allocation.id}",
        start_date: allocation.work_date.iso8601,
        end_date: allocation.work_date.iso8601,
        status: status,
        label: "#{LABELS.fetch(status)} · #{MANUAL_PAYROLL_LABEL}",
        occurred_at: (latest_event&.occurred_at || allocation.voided_at || allocation.issued_at || allocation.created_at).iso8601,
        source_kinds: [ "manual" ],
        total_hours: round_hours(allocation.total_hours),
        regular_hours: round_hours(allocation.regular_hours),
        overtime_hours: round_hours(allocation.overtime_hours),
        external_pay_period_id: allocation.external_pay_period_id,
        external_payroll_item_id: allocation.external_payroll_item_id,
        payment_method: allocation.payment_method,
        payment_reference: allocation.payment_reference,
        payment_effective_on: allocation.payment_effective_on&.iso8601
      }.compact
    end

    def status_for(entry, settlements, manual)
      active_manual = manual.reject { |allocation| allocation.status == "voided" }
      if active_manual.any?
        paid = settlements.sum do |settlement|
          BigDecimal((settlement[:paid_hours] || (settlement.fetch(:status) == "payment_issued" ? settlement.fetch(:total_hours) : 0)).to_s)
        end
        unpaid_allocated = settlements.select do |settlement|
          settlement.fetch(:status).in?(%w[finalized imported committed payment_prepared payment_cancelled])
        end.sum { |settlement| BigDecimal(settlement.fetch(:total_hours).to_s) }
        allocated = paid + unpaid_allocated
        return "partially_paid" if paid.positive? && (paid < entry.hours.to_d || unpaid_allocated.positive?)
        return "payment_issued" if paid.positive?
        return "partially_allocated" if allocated < entry.hours.to_d

        return "payment_cancelled" if settlements.any? { |settlement| settlement[:status] == "payment_cancelled" }

        return "committed"
      end
      if manual.any?
        latest_batch_settlement = settlements.reject { |settlement| settlement.fetch(:batch_id).start_with?("manual-") }.last
        return batch_status_for(entry, settlements.reject { |settlement| settlement.fetch(:batch_id).start_with?("manual-") }) if latest_batch_settlement

        return "payment_voided"
      end
      return batch_status_for(entry, settlements) if settlements.any?
      return "awaiting_approval" if entry.status.in?(%w[clocked_in on_break])
      return "awaiting_approval" if entry.approval_status == "pending" || (entry.manual_entry? && entry.approval_status.nil?) || (entry.overtime_status == "pending" && @weekly_overtime_reviews.fetch(entry.id, false))
      return "not_payable" if entry.approval_status == "denied" || (entry.overtime_status == "denied" && @weekly_overtime_reviews.fetch(entry.id, false))

      "ready_for_cutoff"
    end

    # Source hours can span payroll runs. A later prepared run does not erase
    # earlier issued coverage. Keep attention and noncash correction states
    # explicit rather than hiding them behind an aggregate payment label.
    def batch_status_for(entry, settlements)
      latest = settlements.last
      status = latest.fetch(:status)
      return status if status.in?(%w[payment_voided payment_cancelled payment_failed]) || latest[:accounting_only]

      paid = settlements.sum { |row| row.fetch(:paid_hours, 0).to_d }
      lines = settlements.flat_map { |row| row.fetch(:payable_lines, [ row ]) }
      unpaid = lines.select { |row| !row[:accounting_only] && row[:status].in?(%w[finalized imported committed payment_prepared]) }
        .sum { |row| row[:total_hours].to_d }
      return "partially_paid" if paid.positive? && (paid < entry.hours.to_d || unpaid.positive?)

      status
    end

    # Exclusions are retained history. Only their still-unallocated source
    # quantity remains held; a later allocation must not retain a stale hold.
    def held_hours(entry, settlements, attestation, exclusion)
      lines = settlements.flat_map { |row| row.fetch(:payable_lines, [ row ]) }
      allocated = lines.reject { |row| row[:status] == "payment_voided" }.sum { |row| row[:total_hours].to_d }
      unallocated = [ entry.hours.to_d - allocated, 0.to_d ].max
      exclusion_hours = if exclusion && (PayrollBatchExclusion::CARRYOVER_REASONS + [ "pending_payment_attestation" ]).include?(exclusion.reason)
        exclusion.held_total_hours.to_d
      else
        0.to_d
      end
      held = [ attestation&.hours.to_d || 0.to_d, exclusion_hours ].max
      round_hours([ held, unallocated ].min)
    end

    def round_hours(value)
      BigDecimal(value.to_s).round(2).to_f
    end
  end
end
