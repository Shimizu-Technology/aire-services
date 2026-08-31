# frozen_string_literal: true

require "csv"

module Reports
  class PayrollBatchCsv
    def self.render(batch)
      CSV.generate do |csv|
        csv << [
          "Batch ID", "Period start", "Period end", "Cutoff at", "Employee", "Email",
          "Source entry", "Type", "Original work date", "Category", "Regular hours",
          "Overtime hours", "Total hours"
        ]
        Array(batch.payload["employees"]).each do |employee|
          Array(employee["adjustments"]).each do |row|
            csv << [
              batch.public_id,
              batch.start_date.iso8601,
              batch.end_date.iso8601,
              batch.cutoff_at.iso8601,
              safe(employee["display_name"]),
              safe(employee["email"]),
              row["source_time_entry_id"],
              row["source_kind"],
              row["original_work_date"],
              safe(row.dig("category", "name")),
              row["regular_hours"],
              row["overtime_hours"],
              row["total_hours"]
            ]
          end
        end
      end
    end

    def self.safe(value)
      string = value.to_s
      string.match?(/\A(?:[\t\r]|[ \t\r]*[=+\-@])/) ? "'#{string}" : string
    end
    private_class_method :safe
  end
end
