# frozen_string_literal: true

module Approvals
  # A deliberately small projection of this shift's audit trail. General
  # Activity includes security/payroll data and remains administrator-only.
  class ReviewHistory
    FIELDS = {
      "clock_in_at" => "Clock in", "clock_out_at" => "Clock out",
      "start_time" => "Start time", "end_time" => "End time",
      "work_date" => "Work date", "break_minutes" => "Break minutes",
      "time_category_id" => "Work category", "hours" => "Hours",
      "entry_method" => "Entry method", "clock_source" => "Clock source",
      "description" => "Description"
    }.freeze
    TIMES = %w[clock_in_at clock_out_at].freeze

    def initialize(entry)
      @entry = entry
    end

    def call
      AuditLog.for_subject("TimeEntry", @entry.id).where("action LIKE ?", "time\\_entry.%")
        .recent.limit(20).map { |row| present(row) }
    end

    private

    def present(row)
      # Feed the sentence presenter only shift identity and approved safe
      # metadata. Never let an arbitrary audit metadata key reach this read.
      safe = row.dup
      safe.actor_name = row.actor_name.presence || "Someone"
      safe.actor_email = nil
      safe.subject_name = "#{@entry.hours.to_f} hours on #{@entry.work_date.iso8601}"
      metadata = row.metadata.is_a?(Hash) ? row.metadata : {}
      safe.metadata = metadata.slice("hours", "work_date", "time_reverted", "overtime_reverted", "overtime_status")
        .select { |_key, value| value.is_a?(String) || value.is_a?(Numeric) || value == true || value == false }
        .merge("employee_id" => @entry.user_id, "employee_name" => @entry.user.full_name)
      safe.changes_made = {}
      {
        action: row.action, at: row.occurred_at.in_time_zone("Pacific/Guam").iso8601,
        actor: row.actor_name.present? ? { id: row.user_id, full_name: row.actor_name } : nil,
        sentence: AuditLogPresenter.new(safe).summary,
        reason: [ metadata["correction_reason"], metadata["review_note"] ].find { |value| value.is_a?(String) && value.present? },
        fields: (row.changes_made.is_a?(Hash) ? row.changes_made : {}).filter_map do |field, change|
          next unless FIELDS.key?(field) && change.is_a?(Hash)

          { field: field, label: FIELDS.fetch(field), before: value(field, change["from"]), after: value(field, change["to"]) }
        end
      }
    end

    def value(field, raw)
      return if raw.nil?
      # Drop nested objects even for an allowed field: audit data is not a
      # license to expose an arbitrary object (or somebody else's metadata).
      return unless raw.is_a?(String) || raw.is_a?(Numeric) || raw == true || raw == false
      return TimeCategory.where(id: raw.to_s).pick(:name) if field == "time_category_id" && raw.to_s.match?(/\A\d+\z/)
      return if field == "time_category_id"
      return raw unless TIMES.include?(field)

      Time.iso8601(raw.to_s).in_time_zone("Pacific/Guam").strftime("%b %-d, %Y %-I:%M %p")
    rescue ArgumentError
      nil
    end
  end
end
