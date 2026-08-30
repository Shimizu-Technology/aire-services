# frozen_string_literal: true

require "set"

module Payroll
  class BatchBuilder
    MAX_RANGE_DAYS = 62
    PAIR_QUERY_BATCH_SIZE = 500
    SOURCE = "aire_services"

    attr_reader :start_date, :end_date, :cutoff_at, :batch_reference

    def initialize(start_date:, end_date:, cutoff_at: Time.current, batch_reference: "PREVIEW")
      @start_date = parse_date!(start_date, "start_date")
      @end_date = parse_date!(end_date, "end_date")
      @cutoff_at = cutoff_at
      @batch_reference = batch_reference
      raise ArgumentError, "end_date must be on or after start_date" if @end_date < @start_date
      raise ArgumentError, "date range may not exceed #{MAX_RANGE_DAYS} days" if (@end_date - @start_date).to_i > MAX_RANGE_DAYS
    end

    def call
      latest_batch = PayrollBatch.order(cutoff_at: :desc, id: :desc).first
      seed_entries, deleted_entry_ids = settlement_seed_entries(latest_batch)
      candidate_entry_ids = seed_entries.map(&:id) + deleted_entry_ids
      prior_rows = prior_rows_for_entry_ids(candidate_entry_ids)
      prior_by_entry = prior_rows.group_by(&:source_time_entry_id)
      deleted_prior_rows = deleted_prior_rows(prior_by_entry)
      affected_pairs = affected_employee_weeks(seed_entries, deleted_prior_rows, prior_by_entry)
      prior_rows = (prior_rows + prior_rows_for_pairs(affected_pairs)).uniq(&:id)
      prior_by_entry = prior_rows.group_by(&:source_time_entry_id)
      deleted_prior_rows = deleted_prior_rows(prior_by_entry)
      affected_pairs = affected_employee_weeks(seed_entries, deleted_prior_rows, prior_by_entry)
      context_entries = context_entries_for(affected_pairs)
      allocations = overtime_allocations(context_entries)
      settlement_ids = settlement_entry_ids(seed_entries, prior_rows, affected_pairs)
      preload_first_exclusion_references(settlement_ids)
      current_by_id = context_entries.index_by(&:id)
      rows = []
      exclusions = []
      blocking = { missing_category_count: 0, missing_rate_count: 0 }

      settlement_ids.sort.each do |entry_id|
        entry = current_by_id[entry_id]
        entry_prior_rows = prior_by_entry.fetch(entry_id, [])

        if entry
          target, entry_exclusions = target_for(entry, allocations.fetch(entry.id, {}))
          exclusions.concat(entry_exclusions)
          if target[:total_hours].positive?
            blocking[:missing_category_count] += 1 if entry.time_category_id.nil?
            blocking[:missing_rate_count] += 1 if entry.effective_rate_cents_snapshot.nil?
          end
          rows.concat(settlement_rows_for(entry, target, entry_prior_rows))
        else
          rows.concat(deleted_rows_for(entry_id, entry_prior_rows))
        end
      end

      rows.sort_by! { |row| [ row[:source_user_id], row[:week_start], row[:work_date], row[:source_time_entry_id], row[:line_key] ] }
      exclusions.sort_by! { |row| [ row[:source_user_id], row[:work_date], row[:source_time_entry_id], row[:reason] ] }
      negative_rows = rows.select { |row| row[:regular_hours].negative? || row[:overtime_hours].negative? }
      issues = blocking.merge(
        negative_adjustment_count: negative_rows.size,
        pending_approval_count: exclusions.count { |row| row[:reason].in?(%w[pending_approval approved_after_cutoff created_after_cutoff]) },
        denied_approval_count: exclusions.count { |row| row[:reason] == "denied_approval" },
        open_clock_count: exclusions.count { |row| row[:reason] == "open_clock" },
        pending_overtime_count: exclusions.count { |row| row[:reason].in?(%w[pending_overtime overtime_approved_after_cutoff]) },
        denied_overtime_count: exclusions.count { |row| row[:reason] == "denied_overtime" }
      )
      payload = payload_for(rows, exclusions, issues)

      {
        start_date: start_date,
        end_date: end_date,
        cutoff_at: cutoff_at,
        rows: rows,
        exclusions: exclusions,
        issues: issues,
        summary: payload.fetch(:summary),
        payload: payload,
        checksum: CanonicalPayload.checksum(payload)
      }
    end

    private

    def parse_date!(value, name)
      raise ArgumentError, "#{name} is required" if value.blank?

      Date.iso8601(value.to_s)
    rescue Date::Error
      raise ArgumentError, "#{name} must be a valid ISO 8601 date (YYYY-MM-DD)"
    end

    def settlement_seed_entries(latest_batch)
      nominal = staff_entries.where(work_date: start_date..end_date).to_a
      return [ nominal, [] ] unless latest_batch

      latest_cutoff = latest_batch.cutoff_at
      carryover_ids = unresolved_carryover_ids(latest_batch)
      carryovers = staff_entries.where(id: carryover_ids).to_a
      historical = staff_entries
        .where("time_entries.work_date < ? AND time_entries.updated_at > ?", start_date, latest_cutoff)
        .to_a
      changed_prior = staff_entries
        .where(id: PayrollBatchEntry.select(:source_time_entry_id))
        .where("time_entries.updated_at > ?", latest_cutoff)
        .to_a
      deleted_entry_ids = AuditLog
        .where(action: "time_entry.deleted", auditable_type: "TimeEntry")
        .where("occurred_at > ?", latest_cutoff)
        .distinct
        .pluck(:auditable_id)

      [ (nominal + carryovers + historical + changed_prior).uniq(&:id), deleted_entry_ids ]
    end

    def unresolved_carryover_ids(latest_batch)
      latest_batch.payroll_batch_exclusions
        .where(reason: PayrollBatchExclusion::CARRYOVER_REASONS)
        .distinct
        .pluck(:source_time_entry_id)
    end

    def staff_entries
      TimeEntry.joins(:user).merge(User.staff)
    end

    def deleted_prior_rows(prior_by_entry)
      existing_ids = TimeEntry.where(id: prior_by_entry.keys).pluck(:id).to_set
      prior_by_entry.filter_map do |entry_id, rows|
        next if existing_ids.include?(entry_id)
        next if prior_totals(rows).values.all?(&:zero?)

        rows.max_by { |row| [ row.payroll_batch.cutoff_at, row.id ] }
      end
    end

    def prior_rows_for_entry_ids(entry_ids)
      ids = entry_ids.compact.uniq
      return [] if ids.empty?

      PayrollBatchEntry.includes(:payroll_batch).where(source_time_entry_id: ids).to_a
    end

    def prior_rows_for_pairs(pairs)
      pair_batches(pairs).flat_map do |pair_batch|
        PayrollBatchEntry
          .joins(pair_join_sql(pair_batch, user_column: "source_user_id") do
            <<~SQL
              ON affected_pairs.source_user_id = payroll_batch_entries.source_user_id
             AND affected_pairs.week_start = payroll_batch_entries.week_start
            SQL
          end)
          .includes(:payroll_batch)
          .to_a
      end
    end

    def affected_employee_weeks(seed_entries, deleted_rows, prior_by_entry)
      prior_pairs = seed_entries.flat_map do |entry|
        prior_by_entry.fetch(entry.id, []).map { |row| [ row.source_user_id, row.week_start ] }
      end
      Set.new(
        seed_entries.map { |entry| [ entry.user_id, entry.work_date.beginning_of_week(:sunday) ] } +
        deleted_rows.map { |row| [ row.source_user_id, row.week_start ] } +
        prior_pairs
      )
    end

    def context_entries_for(pairs)
      return [] if pairs.empty?

      pair_batches(pairs).flat_map do |pair_batch|
        TimeEntry
          .joins(pair_join_sql(pair_batch, user_column: "user_id") do
            <<~SQL
              ON affected_pairs.user_id = time_entries.user_id
             AND time_entries.work_date BETWEEN affected_pairs.week_start AND affected_pairs.week_start + 6
            SQL
          end)
          .includes(:user, :time_category, :time_entry_breaks)
          .to_a
      end
        .uniq(&:id)
        .sort_by { |entry| [ entry.work_date, entry.start_time, entry.created_at, entry.id ] }
    end

    def overtime_allocations(entries)
      entries.group_by(&:user_id).each_with_object({}) do |(_user_id, user_entries), memo|
        payable = user_entries.select { |entry| payable_at_cutoff?(entry) }
        memo.merge!(WeeklyOvertimeAllocator.call(payable))
      end
    end

    def payable_at_cutoff?(entry)
      return false unless base_approved?(entry)
      return false if entry.created_at > cutoff_at
      return false if entry.approved_at.present? && entry.approved_at > cutoff_at

      true
    end

    def pair_batches(pairs)
      pairs.to_a.sort_by { |user_id, week_start| [ user_id, week_start ] }.each_slice(PAIR_QUERY_BATCH_SIZE)
    end

    def pair_join_sql(pairs, user_column:)
      records = pairs.map { |user_id, week_start| { user_column => user_id, week_start: week_start.iso8601 } }
      join_clause = yield
      ActiveRecord::Base.sanitize_sql_array([
        <<~SQL.squish,
          INNER JOIN jsonb_to_recordset(?::jsonb)
            AS affected_pairs(#{user_column} bigint, week_start date)
          #{join_clause}
        SQL
        records.to_json
      ])
    end

    def settlement_entry_ids(seed_entries, prior_rows, affected_pairs)
      ids = seed_entries.map(&:id).to_set
      prior_rows.each do |row|
        ids << row.source_time_entry_id if affected_pairs.include?([ row.source_user_id, row.week_start ])
      end
      ids
    end

    def target_for(entry, allocation)
      regular = round_hours(allocation[:regular_hours])
      overtime = round_hours(allocation[:overtime_hours])
      snapshot = entry_snapshot(entry)
      held_regular, held_overtime = held_hours(entry, regular, overtime)

      if entry.created_at > cutoff_at
        return [ zero_hours, [ exclusion_for(entry, "created_after_cutoff", entry.hours, held_regular, held_overtime, snapshot) ] ]
      end
      if entry.status.in?(%w[clocked_in on_break])
        return [ zero_hours, [ exclusion_for(entry, "open_clock", entry.hours, held_regular, held_overtime, snapshot) ] ]
      end
      if entry.approval_status == "pending"
        return [ zero_hours, [ exclusion_for(entry, "pending_approval", entry.hours, held_regular, held_overtime, snapshot) ] ]
      end
      if entry.approval_status == "denied"
        return [ zero_hours, [ exclusion_for(entry, "denied_approval", entry.hours, held_regular, held_overtime, snapshot) ] ]
      end
      if entry.approved_at.present? && entry.approved_at > cutoff_at
        return [ zero_hours, [ exclusion_for(entry, "approved_after_cutoff", entry.hours, held_regular, held_overtime, snapshot) ] ]
      end
      return [ zero_hours, [] ] unless base_approved?(entry)

      overtime_reason = if entry.overtime_status == "pending"
        "pending_overtime"
      elsif entry.overtime_status == "denied"
        "denied_overtime"
      elsif entry.overtime_status == "approved" && entry.overtime_approved_at.present? && entry.overtime_approved_at > cutoff_at
        "overtime_approved_after_cutoff"
      end
      included_overtime = overtime_reason ? 0.to_d : overtime
      exclusions = if overtime_reason && overtime.positive?
        [ exclusion_for(entry, overtime_reason, overtime, 0, overtime, snapshot) ]
      else
        []
      end

      [
        { total_hours: round_hours(regular + included_overtime), regular_hours: regular, overtime_hours: included_overtime },
        exclusions
      ]
    end

    def base_approved?(entry)
      entry.status == "completed" && entry.approval_status.in?([ nil, "approved" ])
    end

    def zero_hours
      { total_hours: 0.to_d, regular_hours: 0.to_d, overtime_hours: 0.to_d }
    end

    def held_hours(entry, regular, overtime)
      total = round_hours(entry.hours)
      return [ regular, overtime ] if round_hours(regular + overtime) == total

      [ total, 0.to_d ]
    end

    def prior_totals(rows)
      sum_hours(rows)
    end

    def prior_balances(rows)
      rows.group_by { |row| dimension_key(row.source_category_id, row.effective_rate_cents) }.transform_values do |dimension_rows|
        {
          totals: sum_hours(dimension_rows),
          latest: dimension_rows.max_by { |row| [ row.payroll_batch.cutoff_at, row.id ] }
        }
      end
    end

    def sum_hours(rows)
      {
        total_hours: round_hours(rows.sum(&:total_hours)),
        regular_hours: round_hours(rows.sum(&:regular_hours)),
        overtime_hours: round_hours(rows.sum(&:overtime_hours))
      }
    end

    def subtract(target, prior)
      target.to_h { |key, value| [ key, round_hours(value - prior.fetch(key)) ] }
    end

    def zero_delta?(delta)
      delta.values.all?(&:zero?)
    end

    def settlement_rows_for(entry, target, prior_rows)
      balances = prior_balances(prior_rows)
      current_key = dimension_key(entry.time_category_id, entry.effective_rate_cents_snapshot)
      keys = balances.keys.to_set
      keys << current_key if target.values.any?(&:nonzero?)
      has_prior = balances.values.any? { |balance| balance.fetch(:totals).values.any?(&:nonzero?) }

      keys.filter_map do |key|
        desired = key == current_key ? target : zero_hours
        prior = balances.dig(key, :totals) || zero_hours
        delta = subtract(desired, prior)
        next if zero_delta?(delta)

        if key == current_key
          row_for_current_dimension(entry, delta, has_prior, current_key)
        else
          row_for_prior_dimension(entry, delta, balances.fetch(key).fetch(:latest), key)
        end
      end
    end

    def row_for_current_dimension(entry, delta, has_prior, line_key)
      {
        source_time_entry_id: entry.id,
        source_user_id: entry.user_id,
        source_category_id: entry.time_category_id,
        work_date: entry.work_date,
        week_start: entry.work_date.beginning_of_week(:sunday),
        total_hours: delta[:total_hours],
        regular_hours: delta[:regular_hours],
        overtime_hours: delta[:overtime_hours],
        effective_rate_cents: entry.effective_rate_cents_snapshot,
        source_kind: source_kind(entry, has_prior),
        line_key: line_key,
        snapshot: entry_snapshot(entry)
      }
    end

    def row_for_prior_dimension(entry, delta, latest, line_key)
      {
        source_time_entry_id: entry.id,
        source_user_id: latest.source_user_id,
        source_category_id: latest.source_category_id,
        work_date: latest.work_date,
        week_start: latest.week_start,
        total_hours: delta[:total_hours],
        regular_hours: delta[:regular_hours],
        overtime_hours: delta[:overtime_hours],
        effective_rate_cents: latest.effective_rate_cents,
        source_kind: "correction",
        line_key: line_key,
        snapshot: latest.snapshot.merge(
          "reallocated_after_prior_batch" => true,
          "current_time_entry" => entry_snapshot(entry)
        )
      }
    end

    def deleted_rows_for(entry_id, prior_rows)
      prior_balances(prior_rows).filter_map do |line_key, balance|
        prior = balance.fetch(:totals)
        next if prior.values.all?(&:zero?)

        latest = balance.fetch(:latest)
        {
          source_time_entry_id: entry_id,
          source_user_id: latest.source_user_id,
          source_category_id: latest.source_category_id,
          work_date: latest.work_date,
          week_start: latest.week_start,
          total_hours: -prior[:total_hours],
          regular_hours: -prior[:regular_hours],
          overtime_hours: -prior[:overtime_hours],
          effective_rate_cents: latest.effective_rate_cents,
          source_kind: "correction",
          line_key: line_key,
          snapshot: latest.snapshot.merge("deleted_after_prior_batch" => true)
        }
      end
    end

    def source_kind(entry, has_prior)
      return "correction" if has_prior
      return "carryover" if entry.work_date < start_date

      "current"
    end

    def dimension_key(category_id, rate_cents)
      "category:#{category_id || 'none'}:rate:#{rate_cents || 'none'}"
    end

    def exclusion_for(entry, reason, total, regular, overtime, snapshot)
      first_reference = @first_exclusion_references.fetch([ entry.id, reason ], nil)
      {
        source_time_entry_id: entry.id,
        source_user_id: entry.user_id,
        reason: reason,
        held_total_hours: round_hours(total),
        held_regular_hours: round_hours(regular),
        held_overtime_hours: round_hours(overtime),
        first_excluded_batch_public_id: first_reference.presence || batch_reference,
        work_date: entry.work_date,
        snapshot: snapshot
      }
    end

    def preload_first_exclusion_references(entry_ids)
      @first_exclusion_references = {}
      ids = entry_ids.to_a.compact.uniq
      return if ids.empty?

      PayrollBatchExclusion
        .where(source_time_entry_id: ids)
        .select("DISTINCT ON (source_time_entry_id, reason) source_time_entry_id, reason, first_excluded_batch_public_id, id")
        .order(:source_time_entry_id, :reason, :id)
        .each do |exclusion|
          @first_exclusion_references[[ exclusion.source_time_entry_id, exclusion.reason ]] = exclusion.first_excluded_batch_public_id
        end
    end

    def entry_snapshot(entry)
      {
        "id" => entry.id,
        "user_id" => entry.user_id,
        "employee_name" => entry.user.full_name,
        "employee_email" => entry.user.email,
        "work_date" => entry.work_date.iso8601,
        "hours" => number(entry.hours),
        "status" => entry.status,
        "approval_status" => entry.approval_status,
        "approved_at" => entry.approved_at&.iso8601,
        "overtime_status" => entry.overtime_status,
        "overtime_approved_at" => entry.overtime_approved_at&.iso8601,
        "effective_rate_cents" => entry.effective_rate_cents_snapshot,
        "time_category" => entry.time_category && {
          "id" => entry.time_category.id,
          "key" => entry.time_category.key,
          "name" => entry.time_category.name
        },
        "updated_at" => entry.updated_at.iso8601
      }
    end

    def payload_for(rows, exclusions, issues)
      employees = rows.group_by { |row| row[:source_user_id] }.sort_by(&:first).map do |user_id, employee_rows|
        snapshot = employee_rows.first[:snapshot]
        {
          source_user_id: user_id.to_s,
          email: snapshot["employee_email"],
          display_name: snapshot["employee_name"],
          adjustments: employee_rows.map { |row| serialize_row(row) },
          total_hours: number(employee_rows.sum { |row| row[:total_hours] }),
          regular_hours: number(employee_rows.sum { |row| row[:regular_hours] }),
          overtime_hours: number(employee_rows.sum { |row| row[:overtime_hours] })
        }
      end
      summary = {
        employee_count: employees.size,
        adjustment_count: rows.size,
        total_hours: number(rows.sum { |row| row[:total_hours] }),
        regular_hours: number(rows.sum { |row| row[:regular_hours] }),
        overtime_hours: number(rows.sum { |row| row[:overtime_hours] }),
        current_count: rows.count { |row| row[:source_kind] == "current" },
        carryover_count: rows.count { |row| row[:source_kind] == "carryover" },
        correction_count: rows.count { |row| row[:source_kind] == "correction" },
        exclusion_count: exclusions.size
      }

      {
        schema_version: PayrollBatch::SCHEMA_VERSION,
        source: SOURCE,
        batch_id: batch_reference,
        start_date: start_date.iso8601,
        end_date: end_date.iso8601,
        cutoff_at: cutoff_at.iso8601,
        generated_at: cutoff_at.iso8601,
        employees: employees,
        exclusions: exclusions.map { |row| serialize_exclusion(row) },
        issues: issues,
        summary: summary
      }
    end

    def serialize_row(row)
      {
        source_time_entry_id: row[:source_time_entry_id].to_s,
        line_key: row[:line_key],
        source_kind: row[:source_kind],
        original_work_date: row[:work_date].iso8601,
        original_week_start: row[:week_start].iso8601,
        source_category_id: row[:source_category_id]&.to_s,
        category: row[:snapshot]["time_category"],
        total_hours: number(row[:total_hours]),
        regular_hours: number(row[:regular_hours]),
        overtime_hours: number(row[:overtime_hours]),
        effective_rate_cents: row[:effective_rate_cents]
      }
    end

    def serialize_exclusion(row)
      {
        source_time_entry_id: row[:source_time_entry_id].to_s,
        source_user_id: row[:source_user_id].to_s,
        display_name: row[:snapshot]["employee_name"],
        email: row[:snapshot]["employee_email"],
        category: row[:snapshot]["time_category"],
        reason: row[:reason],
        original_work_date: row[:work_date].iso8601,
        held_total_hours: number(row[:held_total_hours]),
        held_regular_hours: number(row[:held_regular_hours]),
        held_overtime_hours: number(row[:held_overtime_hours]),
        first_excluded_batch_id: row[:first_excluded_batch_public_id]
      }
    end

    def round_hours(value)
      BigDecimal(value.to_s.presence || "0").round(2)
    end

    def number(value)
      round_hours(value).to_f
    end
  end
end
