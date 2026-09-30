# frozen_string_literal: true

module Payroll
  class EntryProcessingSummary
    class LineConflictError < StandardError; end
    PARTIAL_STATUSES = {
      "payment_failed" => "payment_failed",
      "payment_voided" => "payment_voided",
      "payment_issued" => "partially_paid",
      "payment_prepared" => "partially_prepared"
    }.freeze

    def initialize(rows:, events:, batch_processing: nil)
      @rows = Array(rows)
      @events = Array(events)
      @batch_processing = batch_processing
    end

    def call
      lines = rows.sort_by { |row| [ row.source_time_entry_id, row.line_key ] }.map { |row| line_summary(row) }
      latest_event = lines.filter_map { |line| line.delete(:event) }.max_by do |event|
        [ event.occurred_at, PayrollEntryProcessingEvent::STATUS_RANK.fetch(event.status), event.id ]
      end
      statuses = lines.map { |line| line.fetch(:status) }

      {
        status: aggregate_status(statuses),
        occurred_at: latest_event&.occurred_at&.iso8601 || batch_processing&.fetch(:occurred_at, nil),
        external_system: common_value(lines, :external_system),
        external_pay_period_id: common_value(lines, :external_pay_period_id) || batch_processing&.fetch(:external_pay_period_id, nil),
        external_payroll_item_id: common_value(lines, :external_payroll_item_id),
        payment_method: common_value(lines, :payment_method),
        payment_reference: common_value(lines, :payment_reference),
        total_hours: round_hours(lines.sum { |line| line.fetch(:total_hours) }),
        paid_hours: hours_for(lines, "payment_issued"),
        prepared_hours: hours_for(lines, "payment_prepared"),
        failed_hours: hours_for(lines, "payment_failed"),
        voided_hours: hours_for(lines, "payment_voided"),
        outstanding_hours: round_hours(lines.reject { |line| line[:status] == "payment_issued" }.sum { |line| line.fetch(:total_hours) }),
        lines: lines
      }.compact
    end

    private

    attr_reader :rows, :events, :batch_processing

    def line_summary(row)
      candidates = events.select do |event|
        event.source_line_key.present? ? event.source_line_key == row.line_key : true
      end
      event = candidates.max_by do |candidate|
        [ candidate.occurred_at, PayrollEntryProcessingEvent::STATUS_RANK.fetch(candidate.status), candidate.id ]
      end
      status = event&.status || batch_processing&.fetch(:status, nil) || "finalized"

      {
        source_time_entry_id: row.source_time_entry_id.to_s,
        source_line_key: row.line_key,
        source_kind: row.source_kind,
        total_hours: round_hours(row.total_hours),
        regular_hours: round_hours(row.regular_hours),
        overtime_hours: round_hours(row.overtime_hours),
        status: status,
        occurred_at: event&.occurred_at&.iso8601 || batch_processing&.fetch(:occurred_at, nil),
        external_system: event&.external_system || batch_processing&.fetch(:external_system, nil),
        external_pay_period_id: event&.external_pay_period_id || batch_processing&.fetch(:external_pay_period_id, nil),
        external_payroll_item_id: event&.external_payroll_item_id,
        payment_method: event&.payment_method,
        payment_reference: event&.payment_reference,
        event: event
      }.compact
    end

    def aggregate_status(statuses)
      unique = statuses.uniq
      return unique.first if unique.one?

      PARTIAL_STATUSES.each do |candidate, result|
        return result if unique.include?(candidate)
      end
      "partially_processed"
    end

    def common_value(lines, key)
      values = lines.filter_map { |line| line[key].presence }.uniq
      values.one? ? values.first : nil
    end

    def hours_for(lines, status)
      round_hours(lines.select { |line| line[:status] == status }.sum { |line| line.fetch(:total_hours) })
    end

    def round_hours(value)
      BigDecimal(value.to_s).round(2).to_f
    end
  end
end
