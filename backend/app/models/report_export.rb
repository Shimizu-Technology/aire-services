# frozen_string_literal: true

require "digest"

class ReportExport < ApplicationRecord
  EXPORT_TYPES = %w[employee_timesheet_pdf detailed_entries_csv payroll_summary_csv payroll_time_summary].freeze
  READINESS_STATUSES = %w[complete draft].freeze
  STATES = %w[active stale].freeze

  belongs_to :generated_by, class_name: "User", optional: true

  validates :public_id, presence: true, uniqueness: true
  validates :export_type, inclusion: { in: EXPORT_TYPES }
  validates :readiness_status, inclusion: { in: READINESS_STATUSES }
  validates :state, inclusion: { in: STATES }
  validates :start_date, :end_date, :checksum, :generated_at, :last_downloaded_at, presence: true
  validate :end_date_on_or_after_start_date

  before_validation :assign_public_id, on: :create

  scope :active, -> { where(state: "active") }
  scope :protecting_entries, -> { active.where(protects_entries: true) }

  def self.capture!(export_type:, report:, generated_by: nil, protects_entries: false, deduplicate: false)
    entries = snapshot_entries(report)
    employee_ids = Array(report[:employees]).filter_map { |employee| employee[:id] || employee[:source_user_id] }.map(&:to_i).uniq.sort
    entry_ids = entries.map { |entry| entry.fetch("id").to_i }.uniq.sort
    checksum = Digest::SHA256.hexdigest(JSON.generate(entries))
    now = Time.current
    attributes = {
      export_type: export_type,
      readiness_status: report_ready?(report) ? "complete" : "draft",
      start_date: report.fetch(:start_date),
      end_date: report.fetch(:end_date),
      generated_by: generated_by,
      employee_ids: employee_ids,
      entry_ids: entry_ids,
      filters: report[:filters] || {},
      summary: report[:summary] || {},
      issues: aggregate_issues(report),
      entry_snapshot: entries,
      checksum: checksum,
      protects_entries: protects_entries,
      generated_at: now,
      last_downloaded_at: now
    }

    if deduplicate
      existing = active.find_by(
        export_type: export_type,
        start_date: attributes[:start_date],
        end_date: attributes[:end_date],
        checksum: checksum,
        protects_entries: protects_entries
      )
      if existing
        existing.increment!(:download_count)
        existing.update_column(:last_downloaded_at, now)
        return existing
      end
    end

    create!(attributes)
  end

  def self.active_for_entry(entry_id)
    protecting_entries.where("entry_ids @> ?", [ entry_id.to_i ].to_json)
  end

  def self.invalidate_for_entry!(entry_id:, correction_reason:, changed_by:)
    active_for_entry(entry_id).find_each do |report_export|
      report_export.update!(
        state: "stale",
        stale_at: Time.current,
        stale_reason: "Entry ##{entry_id} corrected by #{changed_by.full_name}: #{correction_reason}"
      )
    end
  end

  private_class_method def self.snapshot_entries(report)
    Array(report[:employees]).flat_map do |employee|
      employee_id = (employee[:id] || employee[:source_user_id]).to_i
      employee_name = employee[:full_name] || employee[:display_name]
      days = Array(employee[:days])

      days.flat_map do |day|
        if day[:entries].present?
          day[:entries].map do |entry|
            entry.deep_stringify_keys.slice(
              "id", "work_date", "start_time", "end_time", "total_hours", "regular_hours",
              "overtime_hours", "break_minutes", "description", "entry_method", "clock_source",
              "approval_status", "overtime_status", "approved_at", "time_category", "breaks"
            ).merge("employee_id" => employee_id, "employee_name" => employee_name)
          end
        else
          Array(day[:categories]).flat_map do |category|
            Array(category[:entry_ids]).map do |entry_id|
              {
                "id" => entry_id.to_i,
                "employee_id" => employee_id,
                "employee_name" => employee_name,
                "work_date" => day[:work_date],
                "time_category" => { "id" => category[:source_category_id], "name" => category[:name] },
                "total_hours" => category[:total_hours],
                "regular_hours" => category[:regular_hours],
                "overtime_hours" => category[:overtime_hours]
              }
            end
          end
        end
      end
    end.sort_by { |entry| [ entry.fetch("employee_id"), entry.fetch("work_date").to_s, entry.fetch("id") ] }
  end

  private_class_method def self.report_ready?(report)
    summary = report[:summary] || {}
    issue_keys = %i[pending_count denied_count pending_overtime_count denied_overtime_count open_clock_count]
    issue_keys.all? { |key| summary[key].to_i.zero? }
  end

  private_class_method def self.aggregate_issues(report)
    (report[:summary] || {}).slice(:pending_count, :denied_count, :pending_overtime_count, :denied_overtime_count, :open_clock_count)
  end

  def assign_public_id
    prefix = case export_type
    when "employee_timesheet_pdf" then "TS"
    when "detailed_entries_csv" then "DETAIL"
    when "payroll_summary_csv" then "SUMMARY"
    else "PAYROLL"
    end
    self.public_id ||= "AIRE-#{prefix}-#{Time.current.strftime('%Y%m%d')}-#{SecureRandom.hex(6).upcase}"
  end

  def end_date_on_or_after_start_date
    return if start_date.blank? || end_date.blank? || end_date >= start_date

    errors.add(:end_date, "must be on or after start date")
  end
end
