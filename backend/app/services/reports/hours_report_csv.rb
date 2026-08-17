# frozen_string_literal: true

require "csv"

module Reports
  class HoursReportCsv
    DETAILED_HEADERS = [
      "Export Reference", "Employee", "Date", "Start", "End", "Break Minutes", "Category",
      "Source", "Entry Method", "Regular Hours", "Overtime Hours", "Total Hours",
      "Approval Status", "Approved By", "Approved At", "Description"
    ].freeze

    SUMMARY_HEADERS = [
      "Export Reference", "Employee", "Departments", "Employee Type", "Regular Hours",
      "Overtime Hours", "Total Hours", "Break Hours", "Entries", "Report Status"
    ].freeze

    def self.detailed(report:, export:)
      CSV.generate(headers: true) do |csv|
        csv << DETAILED_HEADERS
        Array(report[:employees]).each do |employee|
          Array(employee[:days]).each do |day|
            Array(day[:entries]).each do |entry|
              csv << [
                export.public_id,
                employee[:full_name],
                entry[:work_date],
                entry[:formatted_start_time],
                entry[:formatted_end_time],
                entry[:break_minutes],
                entry.dig(:time_category, :name) || "Uncategorized",
                entry[:clock_source],
                entry[:entry_method],
                format_hours(entry[:regular_hours]),
                format_hours(entry[:overtime_hours]),
                format_hours(entry[:total_hours]),
                entry[:approval_status] || "standard",
                entry.dig(:approved_by, :full_name),
                entry[:approved_at],
                entry[:description]
              ]
            end
          end
        end
      end
    end

    def self.summary(report:, export:)
      CSV.generate(headers: true) do |csv|
        csv << SUMMARY_HEADERS
        Array(report[:employees]).each do |employee|
          csv << [
            export.public_id,
            employee[:full_name],
            Array(employee[:approval_group_labels]).presence&.join(" | ") || employee[:approval_group_label],
            employee[:employee_type],
            format_hours(employee[:regular_hours]),
            format_hours(employee[:overtime_hours]),
            format_hours(employee[:total_hours]),
            format_hours(employee[:break_hours]),
            employee[:entries_count],
            employee[:ready] ? "Complete" : "Draft - needs review"
          ]
        end
      end
    end

    def self.format_hours(value)
      format("%.2f", value.to_f)
    end
    private_class_method :format_hours
  end
end
