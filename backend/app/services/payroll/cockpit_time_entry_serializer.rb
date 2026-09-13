# frozen_string_literal: true

module Payroll
  class CockpitTimeEntrySerializer
    def initialize(entry, lifecycle: nil)
      @entry = entry
      @lifecycle = lifecycle
    end

    def as_json
      {
        id: entry.id.to_s,
        version: entry.lock_version,
        work_date: entry.work_date.iso8601,
        start_time: entry.formatted_start_time,
        end_time: entry.formatted_end_time,
        clock_in_at: entry.clock_in_at&.iso8601,
        clock_out_at: entry.clock_out_at&.iso8601,
        hours: entry.hours.to_f,
        break_minutes: entry.break_minutes.to_i,
        breaks: entry.time_entry_breaks.sort_by(&:start_time).map { |record| serialize_break(record) },
        category: serialize_category,
        capture: {
          entry_method: entry.entry_method,
          clock_source: entry.clock_source,
          ordinary: entry.clock_entry? && !entry.admin_override?,
          admin_override: entry.admin_override?
        },
        state: {
          status: entry.status,
          missing_punch: entry.status.in?(%w[clocked_in on_break]) || entry.end_time.blank?,
          approval_status: entry.approval_status || (entry.clock_entry? ? "not_required" : "pending"),
          overtime_status: entry.overtime_status || "none",
          payable_now: entry.counts_toward_hours?
        },
        approval: {
          actor: serialize_actor(entry.approved_by),
          occurred_at: entry.approved_at&.iso8601,
          note: entry.approval_note
        },
        overtime_approval: {
          actor: serialize_actor(entry.overtime_approved_by),
          occurred_at: entry.overtime_approved_at&.iso8601,
          note: entry.overtime_note
        },
        employee: {
          id: entry.user_id&.to_s,
          payroll_integration_id: entry.user&.payroll_integration_uuid,
          name: entry.user&.full_name
        },
        description: entry.description,
        lifecycle: lifecycle,
        created_at: entry.created_at.iso8601,
        updated_at: entry.updated_at.iso8601
      }
    end

    private

    attr_reader :entry, :lifecycle

    def serialize_break(record)
      {
        id: record.id.to_s,
        start_time: record.start_time.iso8601,
        end_time: record.end_time&.iso8601,
        duration_minutes: record.duration_minutes,
        active: record.active?
      }
    end

    def serialize_category
      return unless entry.time_category

      { id: entry.time_category.id.to_s, key: entry.time_category.key, name: entry.time_category.name }
    end

    def serialize_actor(actor)
      return unless actor

      { payroll_integration_id: actor.payroll_integration_uuid, name: actor.full_name }
    end
  end
end
