# frozen_string_literal: true

module Payroll
  # Worker-facing context for My Time, added only for the worker's own entries
  # when My Pay is enabled for them: which paycheck paid an entry, and a plain
  # explanation of why late or held hours move to a later payroll.
  #
  # Like EmployeeEntryStatus this is an allowlist. It returns a statement ID the
  # worker can already see in My Pay, pay dates and a sentence; never settlement
  # internals, payment references or anything about another worker.
  class EmployeeEntryPayContext
    LINKABLE_STATUSES = %w[
      committed payment_prepared payment_issued payment_voided payment_cancelled
      partially_paid partially_prepared partially_processed partially_allocated
    ].freeze
    EXPLAINED_STATUSES = %w[awaiting_approval ready_for_cutoff held partially_allocated partially_processed partially_paid].freeze
    LEADS = {
      "approved_after_cutoff" => "Approved after the %s cutoff",
      "overtime_approved_after_cutoff" => "Approved after the %s cutoff",
      "created_after_cutoff" => "Added after the %s cutoff",
      "pending_approval" => "Still waiting for approval at the %s cutoff",
      "pending_overtime" => "Still waiting for approval at the %s cutoff",
      "open_clock" => "Shift was still open at the %s cutoff"
    }.freeze

    def initialize(entries:, lifecycles:, statuses:, now: Time.current)
      @entries = entries
      @lifecycles = lifecycles
      @statuses = statuses
      @now = now
    end

    def call
      return {} if entries.empty?

      entries.to_h { |entry| [ entry.id, context_for(entry) ] }
    end

    private

    attr_reader :entries, :lifecycles, :statuses, :now

    def context_for(entry)
      status = statuses.fetch(entry.id)
      paychecks = paychecks_for(entry, status)
      note = paychecks.empty? ? note_for(entry, status) : nil
      { paychecks: paychecks.presence, note: note }.compact
    end

    def paychecks_for(entry, status)
      return [] if status.fetch(:status) == "payment_history_unavailable"

      lifecycles.fetch(entry.id).fetch(:settlements).filter_map do |settlement|
        item_id = settlement[:external_payroll_item_id].to_s
        next unless WorkerStatementsClient.valid_statement_id?(item_id)
        next if settlement[:accounting_only] || !LINKABLE_STATUSES.include?(settlement[:status])

        pay_date = pay_dates_by_batch[settlement[:batch_id]] || settlement[:payment_effective_on]
        { statement_id: item_id, pay_date: pay_date.presence }
      end.uniq { |paycheck| paycheck[:statement_id] }
    end

    def note_for(entry, status)
      return unless EXPLAINED_STATUSES.include?(status.fetch(:status))
      return if status.fetch(:status) != "held" && status.fetch(:held_hours).to_f.zero? && !missed_cutoff_ids.include?(entry.id)

      exclusion = latest_exclusions[entry.id]
      if exclusion && LEADS.key?(exclusion.reason)
        reason = exclusion.reason
        cutoff_on = business_date(exclusion.payroll_batch.cutoff_at)
      elsif missed_cutoff_ids.include?(entry.id) && (cutoff = missed_cutoffs[entry.id])
        reason = status.fetch(:status) == "ready_for_cutoff" ? "approved_after_cutoff" : "pending_approval"
        cutoff_on = cutoff
      else
        return
      end

      "#{format(LEADS.fetch(reason), short_date(cutoff_on))} — #{destination_for(entry, reason)}"
    end

    def destination_for(entry, reason)
      settlement_case = active_cases[entry.id]
      waiting = entry.approval_status == "pending" || entry.overtime_status == "pending" || (entry.manual_entry? && entry.approval_status.nil?)
      return "it will be paid on a later payroll once approved" if waiting && reason.in?(%w[pending_approval pending_overtime])
      return "a separate payment is being arranged" if settlement_case&.destination_kind == "supplemental"

      pay_date = settlement_case&.target_payroll_calendar_period&.pay_date || next_pay_date
      pay_date ? "moves to the next payroll (expected #{short_date(pay_date)})" : "moves to the next payroll"
    end

    def entry_ids
      @entry_ids ||= entries.map(&:id)
    end

    def latest_exclusions
      @latest_exclusions ||= PayrollBatchExclusion.includes(:payroll_batch)
        .where(source_time_entry_id: entry_ids)
        .order(:id)
        .to_a
        .group_by(&:source_time_entry_id)
        .transform_values(&:last)
    end

    def active_cases
      @active_cases ||= PayrollSettlementCase.active.includes(:target_payroll_calendar_period)
        .where(source_time_entry_id: entry_ids)
        .order(:id)
        .to_a
        .group_by(&:source_time_entry_id)
        .transform_values(&:last)
    end

    def missed_cutoff_ids
      @missed_cutoff_ids ||= EntryCutoffWarnings.call(entries, now: now)
    end

    def missed_cutoffs
      @missed_cutoffs ||= begin
        missed = entries.select { |entry| missed_cutoff_ids.include?(entry.id) }
        periods = missed.empty? ? [] : PayrollCalendarPeriod.where(cutoff_at: ..now).overlapping(missed.map(&:work_date).min, missed.map(&:work_date).max).to_a
        missed.to_h do |entry|
          period = periods.find { |row| entry.work_date.between?(row.start_date, row.end_date) }
          [ entry.id, period && business_date(period.cutoff_at) ]
        end
      end
    end

    def next_pay_date
      return @next_pay_date if defined?(@next_pay_date)

      @next_pay_date = PayrollCalendarPeriod.where(status: "scheduled").where("cutoff_at > ?", now).order(:cutoff_at).first&.pay_date
    end

    def pay_dates_by_batch
      @pay_dates_by_batch ||= begin
        batch_ids = lifecycles.values.flat_map { |lifecycle| lifecycle.fetch(:settlements).map { |row| row[:batch_id] } }.compact.uniq
        PayrollCalendarPeriod.joins(:payroll_batch).where(payroll_batches: { public_id: batch_ids })
          .pluck("payroll_batches.public_id", :pay_date)
          .to_h { |batch_id, pay_date| [ batch_id, pay_date.iso8601 ] }
      end
    end

    def business_date(time)
      time.in_time_zone(TimeClockService::BUSINESS_TIMEZONE).to_date
    end

    def short_date(date)
      date.strftime("%b %-d")
    end
  end
end
