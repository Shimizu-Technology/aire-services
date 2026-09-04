# frozen_string_literal: true

module Payroll
  class EntryLifecycleResolver
    LABELS = {
      "awaiting_approval" => "Awaiting approval",
      "not_payable" => "Denied / not payable",
      "ready_for_cutoff" => "Ready for next payroll",
      "finalized" => "Included in AIRE cutoff",
      "imported" => "Imported into Cornerstone",
      "committed" => "Payroll committed",
      "payment_prepared" => "Payment prepared",
      "payment_issued" => "Paid",
      "payment_failed" => "Payment needs attention",
      "payment_voided" => "Payment voided"
    }.freeze

    def initialize(entries:)
      @entries = Array(entries).uniq(&:id)
    end

    def call
      return {} if entries.empty?

      rows_by_entry = PayrollBatchEntry
        .includes(payroll_batch: :payroll_batch_processing_events)
        .where(source_time_entry_id: entry_ids)
        .to_a
        .group_by(&:source_time_entry_id)
      entry_events = PayrollEntryProcessingEvent
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

      entries.each_with_object({}) do |entry, result|
        settlements = settlements_for(rows_by_entry.fetch(entry.id, []), entry_events)
        current_status = status_for(entry, settlements)
        latest_event = settlements.last&.fetch(:event, nil)
        latest_exclusion = latest_exclusions[entry.id]

        result[entry.id] = {
          status: current_status,
          label: LABELS.fetch(current_status),
          payment_method: latest_event&.payment_method,
          payment_reference: latest_event&.payment_reference,
          occurred_at: latest_event&.occurred_at&.iso8601 || settlements.last&.dig(:occurred_at),
          latest_excluded_batch_id: latest_exclusion&.payroll_batch&.public_id,
          settlements: settlements.map { |settlement| settlement.except(:event) }
        }.compact
      end
    end

    def self.summary(lifecycles)
      Array(lifecycles).each_with_object(Hash.new(0)) do |lifecycle, counts|
        counts[lifecycle.fetch(:status)] += 1
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
        event = events.max_by do |candidate|
          [ candidate.occurred_at, PayrollEntryProcessingEvent::STATUS_RANK.fetch(candidate.status), candidate.id ]
        end
        batch_processing = batch.processing_status
        status = event&.status || batch_processing&.fetch(:status, nil) || "finalized"
        occurred_at = event&.occurred_at&.iso8601 || batch_processing&.fetch(:occurred_at, nil) || batch.finalized_at.iso8601

        {
          batch_id: batch.public_id,
          start_date: batch.start_date.iso8601,
          end_date: batch.end_date.iso8601,
          status: status,
          label: LABELS.fetch(status, status.humanize),
          occurred_at: occurred_at,
          source_kinds: batch_rows.map(&:source_kind).uniq.sort,
          total_hours: round_hours(batch_rows.sum(&:total_hours)),
          regular_hours: round_hours(batch_rows.sum(&:regular_hours)),
          overtime_hours: round_hours(batch_rows.sum(&:overtime_hours)),
          external_pay_period_id: event&.external_pay_period_id || batch_processing&.fetch(:external_pay_period_id, nil),
          external_payroll_item_id: event&.external_payroll_item_id,
          payment_method: event&.payment_method,
          payment_reference: event&.payment_reference,
          event: event
        }.compact
      end
    end

    def status_for(entry, settlements)
      return settlements.last.fetch(:status) if settlements.any?
      return "awaiting_approval" if entry.status.in?(%w[clocked_in on_break])
      return "awaiting_approval" if entry.approval_status == "pending" || entry.overtime_status == "pending"
      return "not_payable" if entry.approval_status == "denied" || entry.overtime_status == "denied"

      "ready_for_cutoff"
    end

    def round_hours(value)
      BigDecimal(value.to_s).round(2).to_f
    end
  end
end
