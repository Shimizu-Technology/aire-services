# frozen_string_literal: true

class AuditRecordSnapshot
  SAFE_FIELDS = {
    "User" => %w[
      email first_name last_name role staff_title is_intern approval_group is_active
      personal_access_enabled profile_source time_tracking_enabled kiosk_enabled
      public_team_enabled public_team_name public_team_title public_team_sort_order
      public_team_photo_position_x public_team_photo_position_y
    ],
    "TimeEntry" => %w[
      user_id work_date start_time end_time hours description time_category_id break_minutes
      status entry_method clock_source approval_status approval_note overtime_status overtime_note
      attendance_status schedule_id
    ],
    "LeaveRequest" => %w[
      user_id leave_type start_date end_date status reason review_note reviewed_by_id reviewed_at
      cancelled_by_id cancelled_at
    ],
    "Schedule" => %w[user_id work_date start_time end_time notes created_by_id],
    "TimeCategory" => %w[key name description is_active],
    "Setting" => %w[key value],
    "SiteMedia" => %w[title alt_text caption placement media_type external_url sort_order active featured],
    "ReportExport" => %w[export_type readiness_status state start_date end_date checksum protects_entries],
    "PayrollBatch" => %w[public_id start_date end_date cutoff_at finalized_at checksum]
  }.freeze
  SENSITIVE_PATTERN = /(password|pin|token|secret|digest|lookup_hash|authorization|cookie|cipher|routing|account)/i

  class << self
    def changes_for(record)
      return empty_result unless record.respond_to?(:saved_changes)

      safe_fields = SAFE_FIELDS.fetch(record.class.name, [])
      before_values = {}
      after_values = {}
      redacted_fields = []

      record.saved_changes.each do |field, values|
        next if %w[created_at updated_at].include?(field)

        if field.match?(SENSITIVE_PATTERN)
          redacted_fields << display_field(field)
        elsif safe_fields.include?(field)
          before_values[field] = serializable(values.first)
          after_values[field] = serializable(values.last)
        end
      end

      {
        before_values: before_values,
        after_values: after_values,
        changed_fields: (before_values.keys | after_values.keys | redacted_fields).sort,
        redacted_fields: redacted_fields.sort
      }
    end

    def subject_name(record)
      return if record.blank?
      return record.full_name if record.respond_to?(:full_name) && record.full_name.present?
      return record.name if record.respond_to?(:name) && record.name.present?
      return record.title if record.respond_to?(:title) && record.title.present?
      return record.email if record.respond_to?(:email) && record.email.present?

      if record.respond_to?(:work_date) && record.respond_to?(:hours)
        return "#{record.hours.to_f.round(2)} hours on #{record.work_date}"
      end
      if record.respond_to?(:start_date) && record.respond_to?(:end_date)
        return "#{record.start_date} through #{record.end_date}"
      end

      nil
    end

    private

    def empty_result
      { before_values: {}, after_values: {}, changed_fields: [], redacted_fields: [] }
    end

    def display_field(field)
      field.sub(/_(digest|hash|encrypted)\z/, "")
    end

    def serializable(value)
      return value.iso8601 if value.respond_to?(:iso8601)

      value
    end
  end
end
