# frozen_string_literal: true

module Payroll
  class PayableContent
    FIELDS = %w[user_id work_date start_time end_time clock_in_at clock_out_at hours break_minutes time_category_id status entry_method approval_status overtime_status].freeze

    def self.checksum(entry)
      CanonicalPayload.checksum(entry.attributes.slice(*FIELDS).merge(
        "breaks" => entry.time_entry_breaks.map { |row| row.attributes.slice("start_time", "end_time", "duration_minutes") }
          .sort_by { |row| row["start_time"].to_s }
      ))
    end

    def self.chronology_checksum(entry)
      CanonicalPayload.checksum(entry.attributes.slice("start_time", "end_time", "clock_in_at", "clock_out_at", "break_minutes").merge(
        "breaks" => entry.time_entry_breaks.map { |row| row.attributes.slice("start_time", "end_time", "duration_minutes") }
          .sort_by { |row| row["start_time"].to_s }
      ))
    end

    def self.changed_from_snapshot?(entry, snapshot, legacy_baseline: nil)
      return checksum(entry) != snapshot["payable_content_checksum"] if snapshot["payable_content_checksum"]

      # Older immutable snapshots do not have the content checksum. Compare
      # the payable fields they did retain; a sibling touch is not an edit.
      inferred_category_only = snapshot["time_category_inferred_from_sole_assignment"] && entry.time_category_id.nil?
      fields = %w[user_id work_date hours status entry_method approval_status overtime_status]
      fields.any? { |field| snapshot.key?(field) && entry.public_send(field).to_s != snapshot[field].to_s } ||
        (snapshot["time_category"] && !inferred_category_only && entry.time_category_id != snapshot.dig("time_category", "id")) ||
        (!legacy_baseline.nil? && chronology_checksum(entry) != chronology_checksum(legacy_baseline))
    end
  end
end
