# frozen_string_literal: true

module Payroll
  # Read evidence by original work interval. Destination runs are references,
  # never additional worked hours. Receipt components describe source coverage;
  # they do not describe the classification or amount on a paycheck.
  class EmployeePeriodEvidence
    CONTRACT_VERSION = "1.0"
    BUCKETS = %i[worked_hours eligible_hours pending_hours denied_hours issued_hours committed_hours exported_hours held_hours needs_reconciliation_hours].freeze
    MAX_ROWS = 50_000

    def initialize(user:, params: {})
      @user = user
      @params = params.symbolize_keys
      @start_date = date(:start_date)
      @end_date = date(:end_date)
      raise ArgumentError, "end_date must be on or after start_date" if @start_date && @end_date && @end_date < @start_date
    end

    def call(period_id: nil)
      periods = build_periods
      if period_id
        period = periods.find { |row| row[:id] == period_id }
        raise ActiveRecord::RecordNotFound unless period

        return envelope.merge(period: detail_page(period))
      end
      raise ArgumentError, "per_page must be a positive integer" unless params.fetch(:per_page, 20).to_s.match?(/\A[1-9]\d*\z/)

      limit = Integer(params.fetch(:per_page, 20).to_s, 10)
      raise ArgumentError, "per_page must be between 1 and 100" unless limit.between?(1, 100)

      boundary = cursor_boundary
      filtered = boundary ? periods.select { |row| row[:id] < boundary } : periods
      page = filtered.first(limit)
      next_cursor = filtered.size > limit ? verifier.generate(cursor_context.merge("before" => page.last[:id])) : nil
      envelope.merge(
        totals: totals(periods),
        periods: page.map { |row| row.except(:entries, :coverage_lines, :settlement_cases) },
        pagination: { per_page: limit, total_count: periods.size, next_cursor: next_cursor }
      )
    end

    private

    attr_reader :user, :params, :start_date, :end_date

    def date(key)
      return if params[key].blank?
      raise ArgumentError unless params[key].to_s.match?(/\A\d{4}-\d{2}-\d{2}\z/)

      Date.iso8601(params[key].to_s)
    rescue ArgumentError
      raise ArgumentError, "#{key} must use YYYY-MM-DD"
    end

    def verifier
      Rails.application.message_verifier("employee-period-evidence-v1")
    end

    def cursor_context
      { "source_instance_id" => IntegrationProfile.source_instance_id, "employee_uuid" => user.payroll_integration_uuid, "start_date" => start_date&.iso8601, "end_date" => end_date&.iso8601 }
    end

    def cursor_boundary
      return if params[:cursor].blank?

      cursor = verifier.verified(params[:cursor].to_s)
      unless cursor.is_a?(Hash) && cursor.except("before") == cursor_context && cursor["before"].to_s.match?(/\A\d{4}-\d{2}-\d{2}\z/)
        raise ArgumentError, "Cursor does not match this employee and date filter; restart from the first page"
      end
      cursor["before"]
    end

    def detail_page(period)
      text = params.fetch(:detail_per_page, 100).to_s
      raise ArgumentError, "detail_per_page must be between 1 and 100" unless text.match?(/\A[1-9]\d*\z/) && text.to_i.between?(1, 100)

      limit = text.to_i
      period = focused_detail(period)
      context = cursor_context.merge("period_id" => period[:id], "detail_per_page" => limit, "entry_id" => params[:entry_id].presence&.to_s)
      offset = 0
      if params[:detail_cursor].present?
        cursor = verifier.verified(params[:detail_cursor].to_s)
        unless cursor.is_a?(Hash) && cursor.except("offset") == context && cursor["offset"].is_a?(Integer) && cursor["offset"].between?(0, MAX_ROWS)
          raise ArgumentError, "Detail cursor does not match this employee, period and date filter; restart the period review"
        end
        offset = cursor["offset"]
      end
      collections = %i[entries coverage_lines settlement_cases]
      counts = collections.index_with { |key| period.fetch(key).size }
      next_cursor = counts.values.max > offset + limit ? verifier.generate(context.merge("offset" => offset + limit)) : nil
      result = period.dup
      collections.each { |key| result[key] = period.fetch(key).slice(offset, limit) || [] }
      result[:detail_pagination] = { per_page: limit, offset: offset, counts: counts, next_cursor: next_cursor }
      result
    end

    def focused_detail(period)
      return period if params[:entry_id].blank?
      raise ArgumentError, "entry_id must be a positive integer" unless params[:entry_id].to_s.match?(/\A[1-9]\d*\z/)

      id = params[:entry_id].to_s
      result = period.merge(
        entries: period[:entries].select { |row| row[:id] == id },
        coverage_lines: period[:coverage_lines].select { |row| row[:source_time_entry_id] == id },
        settlement_cases: period[:settlement_cases].select { |row| row["source_time_entry_id"].to_s == id }
      )
      raise ActiveRecord::RecordNotFound if %i[entries coverage_lines settlement_cases].all? { |key| result[key].empty? }

      result
    end

    def envelope
      { contract_version: CONTRACT_VERSION, integration: IntegrationProfile.call,
        as_of: Time.current.iso8601, source_state: "current_with_retained_evidence",
        filters: { start_date: start_date&.iso8601, end_date: end_date&.iso8601 },
        employee: { id: user.id.to_s, payroll_integration_id: user.payroll_integration_uuid,
                    full_name: user.full_name, active: user.is_active?, time_tracking_enabled: user.time_tracking_enabled? },
        actual_check_components: nil, amount_owed: nil,
        evidence_note: "Source coverage confirms receipt state, not actual check REG/OT or money owed. Review the saved paycheck in payroll. Missing coverage needs reconciliation." }
    end

    def bounded(scope)
      rows = scope.limit(MAX_ROWS + 1).to_a
      raise ArgumentError, "More than #{MAX_ROWS} evidence rows; narrow the date range" if rows.size > MAX_ROWS

      rows
    end

    def date_scope(scope, column)
      scope = scope.where(column => start_date..) if start_date
      scope = scope.where(column => ..end_date) if end_date
      scope
    end

    def build_periods
      entries = bounded(date_scope(TimeEntry.where(user: user).includes(:time_category), :work_date).order(:work_date, :id))
      frozen = bounded(date_scope(PayrollBatchEntry.where(source_user_id: user.id)
        .includes(payroll_batch: :payroll_batch_processing_events), :work_date).order(:id))
      manual = bounded(date_scope(PayrollManualAllocation.where(user: user), :work_date).order(:id))
      cases = bounded(date_scope(PayrollSettlementCase.where(source_user_id: user.id), :original_work_date).order(:id))
      holds = bounded(date_scope(PayrollPaymentAttestation.pending_evidence.where(user: user), :work_date).order(:id)).index_by(&:time_entry_id)
      events = bounded(PayrollEntryProcessingEvent.where(payroll_batch_id: frozen.map(&:payroll_batch_id).uniq)
        .where(source_time_entry_id: frozen.map(&:source_time_entry_id).uniq).order(:id))
      events_by_line = events.group_by { |event| [ event.payroll_batch_id, event.source_time_entry_id ] }
      allocations = current_allocations(entries)
      lines = frozen.map { |row| frozen_line(row, events_by_line.fetch([ row.payroll_batch_id, row.source_time_entry_id ], [])) }
      lines.concat(manual.map { |row| manual_line(row) })
      hold_rows = holds.values
      lines.concat(hold_rows.map { |hold| hold_line(hold) })
      dates = entries.map(&:work_date) + frozen.map(&:work_date) + manual.map(&:work_date) + cases.map(&:original_work_date) + hold_rows.map(&:work_date)
      entries_by_period = entries.group_by { |entry| period_start(entry.work_date) }
      lines_by_period = lines.group_by { |line| period_start(Date.iso8601(line[:work_date])) }
      cases_by_period = cases.group_by { |row| period_start(row.original_work_date) }
      dates.map { |work_date| period_start(work_date) }.uniq.sort.reverse.map do |starts_on|
        ends_on = starts_on.day == 1 ? starts_on.change(day: 15) : starts_on.end_of_month
        period_entries = entries_by_period.fetch(starts_on, [])
        period_lines = lines_by_period.fetch(starts_on, [])
        period_cases = cases_by_period.fetch(starts_on, [])
        lines_by_entry = period_lines.group_by { |line| line[:source_time_entry_id] }
        entry_rows = period_entries.map { |entry| current_entry(entry, allocations.fetch(entry.id, {}), lines_by_entry.fetch(entry.id.to_s, []), holds[entry.id]) }
        summary = BUCKETS.index_with { |key| round(entry_rows.sum { |row| row[key].to_d }) }
        # Retained receipts include deleted source rows and signed corrections.
        %i[issued committed exported].each do |bucket|
          summary[:"#{bucket}_hours"] = round(period_lines.select { |line| line[:coverage_state] == bucket.to_s }.sum { |line| line[:total_hours].to_d })
        end
        represented_ids = period_entries.map(&:id)
        summary[:held_hours] = round(summary[:held_hours].to_d + hold_rows.select { |hold| period_start(hold.work_date) == starts_on && !represented_ids.include?(hold.time_entry_id) }.sum(&:hours))
        summary[:current_regular_hours] = round(entry_rows.sum { |row| row[:regular_hours].to_d })
        summary[:current_overtime_hours] = round(entry_rows.sum { |row| row[:overtime_hours].to_d })
        summary[:frozen_regular_hours] = round(period_lines.select { |line| !line[:source_kind].in?(%w[manual payment_attestation]) && line[:coverage_state].in?(%w[issued committed exported]) }.sum { |line| line[:regular_hours].to_d })
        summary[:frozen_overtime_hours] = round(period_lines.select { |line| !line[:source_kind].in?(%w[manual payment_attestation]) && line[:coverage_state].in?(%w[issued committed exported]) }.sum { |line| line[:overtime_hours].to_d })
        summary[:unissued_correction_count] = period_lines.count { |line| line[:source_kind] == "correction" && line[:coverage_state].in?(%w[exported committed]) }
        summary[:open_case_count] = period_cases.count { |row| row.status.in?(PayrollSettlementCase::ACTIVE_STATUSES) }
        summary[:identity_review_count] = period_lines.count { |line| line[:identity_state] != "verified" } + period_cases.count { |row| row.source_user_uuid != user.payroll_integration_uuid }
        summary[:uncategorized_entry_count] = period_entries.count { |entry| entry.time_category_id.nil? }
        summary[:retained_entry_count] = period_lines.map { |line| line[:source_time_entry_id] }.uniq.size
        { id: starts_on.iso8601, start_date: starts_on.iso8601, end_date: ends_on.iso8601,
          summary: summary, entries: entry_rows, coverage_lines: period_lines,
          actual_check_components: nil, amount_owed: nil,
          review_required: summary[:needs_reconciliation_hours].positive? || summary[:held_hours].positive? || summary[:open_case_count].positive? || summary[:identity_review_count].positive? || summary[:uncategorized_entry_count].positive? || summary[:unissued_correction_count].positive?,
          settlement_cases: period_cases.map { |row| row.attributes.slice("public_id", "source_time_entry_id", "status", "origin_reason", "destination_kind", "target_external_pay_period_id", "held_total_hours", "action_due_on") } }
      end
    end

    def current_allocations(entries)
      return {} if entries.empty?

      context = bounded(TimeEntry.where(user: user, work_date: entries.first.work_date.beginning_of_week(:sunday)..entries.last.work_date.end_of_week(:sunday)).order(:work_date, :id))
      WeeklyOvertimeAllocator.call(context.select(&:counts_toward_hours?))
    end

    def current_entry(entry, allocation, lines, hold)
      matching = lines
      issued = matching.select { |line| line[:coverage_state] == "issued" }.sum { |line| line[:total_hours].to_d }
      committed = matching.select { |line| line[:coverage_state] == "committed" }.sum { |line| line[:total_hours].to_d }
      exported = matching.select { |line| line[:coverage_state] == "exported" }.sum { |line| line[:total_hours].to_d }
      eligible = entry.counts_toward_hours? ? entry.hours.to_d : 0.to_d
      ot_review = allocation[:overtime_hours].to_f.positive? && entry.overtime_status.in?(%w[pending denied])
      eligible -= allocation[:overtime_hours].to_d if ot_review
      held = [ hold&.hours.to_d || 0.to_d, [ eligible - issued - committed - exported, 0.to_d ].max ].min
      remaining = [ eligible - issued - committed - exported - held, 0.to_d ].max
      { id: entry.id.to_s, version: entry.lock_version, work_date: entry.work_date.iso8601,
        start_time: entry.start_time&.in_time_zone(TimeClockService::BUSINESS_TIMEZONE)&.strftime("%H:%M"),
        end_time: entry.end_time&.in_time_zone(TimeClockService::BUSINESS_TIMEZONE)&.strftime("%H:%M"),
        description: entry.description, category: entry.time_category&.name, approval_status: entry.approval_status,
        overtime_status: entry.overtime_status, status: entry.status,
        regular_hours: allocation[:regular_hours].to_f, overtime_hours: allocation[:overtime_hours].to_f,
        worked_hours: round(entry.hours), eligible_hours: round(eligible),
        pending_hours: entry.approval_status == "pending" || entry.active? || (entry.manual_entry? && entry.approval_status.nil?) ? round(entry.hours) : (ot_review && entry.overtime_status == "pending" ? allocation[:overtime_hours] : 0),
        denied_hours: entry.approval_status == "denied" ? round(entry.hours) : (ot_review && entry.overtime_status == "denied" ? allocation[:overtime_hours] : 0),
        issued_hours: round(issued), committed_hours: round(committed), exported_hours: round(exported),
        held_hours: round(held), needs_reconciliation_hours: round(remaining), payment_attestation: hold&.reason }
    end

    def frozen_line(row, events)
      candidates = events.select { |event| (event.source_line_key.blank? || event.source_line_key == row.line_key) && (event.source_user_uuid.nil? || event.source_user_uuid == user.payroll_integration_uuid) }
      event = candidates.max_by { |candidate| [ candidate.occurred_at, PayrollEntryProcessingEvent::STATUS_RANK.fetch(candidate.status), candidate.id ] }
      status = event&.status || row.payroll_batch.processing_status&.fetch(:status) || "finalized"
      { id: "batch-#{row.id}", batch_id: row.payroll_batch.public_id, source_time_entry_id: row.source_time_entry_id.to_s,
        source_user_uuid: row.source_user_uuid, source_line_key: row.line_key, source_kind: row.source_kind,
        work_date: row.work_date.iso8601, regular_hours: round(row.regular_hours), overtime_hours: round(row.overtime_hours), total_hours: round(row.total_hours),
        status: status, coverage_state: row.source_user_uuid.present? && row.source_user_uuid != user.payroll_integration_uuid ? "identity_review" : coverage_state(status),
        identity_state: row.source_user_uuid.blank? ? "legacy_identity_unknown" : (row.source_user_uuid == user.payroll_integration_uuid ? "verified" : "frozen_owner_mismatch"),
        destination_start_date: row.payroll_batch.start_date.iso8601, destination_end_date: row.payroll_batch.end_date.iso8601,
        external_pay_period_id: event&.external_pay_period_id, external_payroll_item_id: event&.external_payroll_item_id,
        payment_reference: event&.payment_reference, payment_method: event&.payment_method,
        occurred_at: event&.occurred_at&.iso8601, source_snapshot: row.snapshot,
        actual_check_components: nil, provenance: "frozen_batch_and_authenticated_receipt" }
    end

    def manual_line(row)
      { id: "manual-#{row.id}", source_time_entry_id: row.time_entry_id.to_s,
        source_kind: "manual", work_date: row.work_date.iso8601,
        regular_hours: round(row.regular_hours), overtime_hours: round(row.overtime_hours), total_hours: round(row.total_hours),
        status: row.status, source_user_uuid: row.source_user_uuid, coverage_state: row.source_user_uuid == user.payroll_integration_uuid ? coverage_state(row.status) : "identity_review", external_pay_period_id: row.external_pay_period_id,
        external_payroll_item_id: row.external_payroll_item_id, payment_reference: row.payment_reference,
        payment_method: row.payment_method, payment_effective_on: row.payment_effective_on&.iso8601,
        identity_state: row.source_user_uuid == user.payroll_integration_uuid ? "verified" : "frozen_owner_mismatch", reason: row.reason, actual_check_components: nil, provenance: "manual_source_allocation" }
    end

    def hold_line(hold)
      { id: "hold-#{hold.id}", source_time_entry_id: hold.time_entry_id.to_s, source_kind: "payment_attestation",
        work_date: hold.work_date.iso8601, regular_hours: nil, overtime_hours: nil, total_hours: round(hold.hours),
        status: hold.status, source_user_uuid: hold.source_user_uuid, coverage_state: "evidence_hold", identity_state: hold.source_user_uuid == user.payroll_integration_uuid ? "verified" : "frozen_owner_mismatch",
        reason: hold.reason, actual_check_components: nil, provenance: "payment_attestation_pending_exact_evidence" }
    end

    def coverage_state(status)
      return "issued" if status.in?(%w[payment_issued issued])
      return "committed" if status.in?(%w[committed payment_prepared])
      return "exported" if status.in?(%w[finalized imported])

      "inactive"
    end

    def period_start(work_date)
      work_date.change(day: work_date.day <= 15 ? 1 : 16)
    end

    def totals(periods)
      keys = BUCKETS + %i[current_regular_hours current_overtime_hours frozen_regular_hours frozen_overtime_hours]
      keys.index_with { |key| round(periods.sum { |period| period[:summary][key].to_d }) }
        .merge(unissued_correction_count: periods.sum { |period| period[:summary][:unissued_correction_count] }, open_case_count: periods.sum { |period| period[:summary][:open_case_count] }, identity_review_count: periods.sum { |period| period[:summary][:identity_review_count] }, uncategorized_entry_count: periods.sum { |period| period[:summary][:uncategorized_entry_count] })
    end

    def round(value)
      value.to_d.round(2).to_f
    end
  end
end
