# frozen_string_literal: true

module Payroll
  class CarryoverQueue
    MAX_ITEMS = 250

    def call
      carryover_entry_ids = PayrollBatchExclusion
        .where(reason: PayrollBatchExclusion::CARRYOVER_REASONS)
        .select(:source_time_entry_id)
      latest_exclusion_ids = PayrollBatchExclusion
        .where(source_time_entry_id: carryover_entry_ids)
        .select("DISTINCT ON (source_time_entry_id) id")
        .order(:source_time_entry_id, id: :desc)
        .map(&:id)
      return empty_result if latest_exclusion_ids.empty?

      # Keep every association query bounded while still calculating summary
      # totals from the complete latest-exclusion set.
      all_items = latest_exclusion_ids.each_slice(MAX_ITEMS).flat_map do |exclusion_ids|
        serialize_exclusion_slice(exclusion_ids)
      end
      all_items.sort_by! { |item| [ status_rank(item.fetch(:status)), item.fetch(:original_work_date), item.fetch(:source_time_entry_id).to_i ] }
      summary = summary_for(all_items)
      items = all_items.first(MAX_ITEMS)

      {
        items: items,
        summary: summary,
        truncated: all_items.size > items.size
      }
    end

    private

    def empty_result
      {
        items: [],
        summary: {
          awaiting_approval_count: 0,
          ready_for_next_batch_count: 0,
          in_payroll_count: 0,
          not_payable_count: 0
        },
        truncated: false
      }
    end

    def serialize_exclusion_slice(exclusion_ids)
      exclusions_by_id = PayrollBatchExclusion
        .includes(:payroll_batch)
        .where(id: exclusion_ids)
        .index_by(&:id)
      exclusions = exclusion_ids.filter_map { |id| exclusions_by_id[id] }
      entry_ids = exclusions.map(&:source_time_entry_id)
      current_entries = TimeEntry.includes(:user, :time_category).where(id: entry_ids).index_by(&:id)
      later_entries = PayrollBatchEntry
        .includes(payroll_batch: [ :payroll_batch_processing_events, :payroll_entry_processing_events ])
        .where(source_time_entry_id: entry_ids)
        .to_a
        .group_by(&:source_time_entry_id)

      exclusions.filter_map do |exclusion|
        serialize(exclusion, current_entries[exclusion.source_time_entry_id], later_entries[exclusion.source_time_entry_id] || [])
      end
    end

    def summary_for(items)
      {
        awaiting_approval_count: items.count { |item| item[:status] == "awaiting_approval" },
        ready_for_next_batch_count: items.count { |item| item[:status] == "ready_for_next_batch" },
        in_payroll_count: items.count { |item| item[:status].in?(%w[finalized awaiting_cornerstone imported committed payment_prepared payment_issued payment_failed payment_voided]) },
        not_payable_count: items.count { |item| item[:status] == "not_payable" }
      }
    end

    def serialize(exclusion, entry, settlement_rows)
      included_row = settlement_rows
        .select { |row| row.payroll_batch.cutoff_at > exclusion.payroll_batch.cutoff_at }
        .max_by { |row| [ row.payroll_batch.cutoff_at, row.id ] }
      batch = included_row&.payroll_batch
      processing = entry_processing_status(batch, exclusion.source_time_entry_id) || batch&.processing_status
      snapshot = exclusion.snapshot || {}
      status = status_for(exclusion, entry, batch, processing)

      {
        source_time_entry_id: exclusion.source_time_entry_id.to_s,
        source_user_id: exclusion.source_user_id.to_s,
        source_user_uuid: exclusion.source_user_uuid&.to_s || snapshot["user_uuid"],
        display_name: entry&.user&.full_name || snapshot["employee_name"] || "Former team member",
        email: entry&.user&.email || snapshot["employee_email"],
        category: category_for(entry, snapshot),
        original_work_date: (entry&.work_date || snapshot["work_date"]).to_s,
        first_excluded_batch_id: first_excluded_batch_id(exclusion),
        latest_excluded_batch_id: exclusion.payroll_batch.public_id,
        exclusion_reason: exclusion.reason,
        held_total_hours: exclusion.held_total_hours.to_f,
        current_total_hours: entry&.hours&.to_f,
        status: status,
        included_batch: batch && {
          id: batch.public_id,
          start_date: batch.start_date.iso8601,
          end_date: batch.end_date.iso8601,
          processing: processing
        }
      }
    end

    def status_for(exclusion, entry, batch, processing)
      return processing&.fetch(:status, nil) || "awaiting_cornerstone" if batch
      return "not_payable" if entry.nil? || exclusion.reason.in?(%w[denied_approval denied_overtime])
      return "awaiting_approval" if entry.status.in?(%w[clocked_in on_break])
      return "awaiting_approval" if entry.approval_status == "pending" || entry.overtime_status == "pending"
      return "not_payable" if entry.approval_status == "denied" || entry.overtime_status == "denied"
      return "ready_for_next_batch" if entry.status == "completed" && entry.approval_status.in?([ nil, "approved" ])

      "awaiting_approval"
    end

    def category_for(entry, snapshot)
      category = entry&.time_category
      return { id: category.id, key: category.key, name: category.name } if category

      snapshot["time_category"]
    end

    def entry_processing_status(batch, source_time_entry_id)
      return unless batch

      event = batch.payroll_entry_processing_events
        .select { |candidate| candidate.source_time_entry_id == source_time_entry_id }
        .max_by do |candidate|
          [ candidate.occurred_at, PayrollEntryProcessingEvent::STATUS_RANK.fetch(candidate.status), candidate.id ]
        end
      return unless event

      {
        status: event.status,
        occurred_at: event.occurred_at.iso8601,
        external_system: event.external_system,
        external_pay_period_id: event.external_pay_period_id,
        external_payroll_item_id: event.external_payroll_item_id,
        payment_method: event.payment_method,
        payment_reference: event.payment_reference
      }.compact
    end

    def first_excluded_batch_id(exclusion)
      exclusion.first_excluded_batch_public_id.presence || exclusion.payroll_batch.public_id
    end

    def status_rank(status)
      {
        "ready_for_next_batch" => 0,
        "awaiting_approval" => 1,
        "payment_failed" => 2,
        "payment_voided" => 2,
        "awaiting_cornerstone" => 3,
        "imported" => 4,
        "committed" => 5,
        "payment_prepared" => 6,
        "payment_issued" => 7,
        "not_payable" => 10
      }.fetch(status, 8)
    end
  end
end
