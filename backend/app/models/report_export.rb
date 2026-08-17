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
    employee_ids = Array(report[:employees]).filter_map { |employee| employee[:id] || employee[:source_user_id] }.map(&:to_i).uniq.sort
    entries = snapshot_entries(report, employee_ids: employee_ids)
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

  def self.invalidate_for_entry!(entry_id:, changed_by:, reason: nil, correction_reason: nil)
    change_reason = reason.presence || correction_reason.presence || "Ledger data changed"

    active_for_entry(entry_id).find_each do |report_export|
      report_export.update!(
        state: "stale",
        stale_at: Time.current,
        stale_reason: "Entry ##{entry_id} changed by #{changed_by.full_name}: #{change_reason}"
      )
    end
  end

  private_class_method def self.snapshot_entries(report, employee_ids:)
    visible_entries = Array(report[:employees]).flat_map do |employee|
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
    end

    # A report's regular/overtime and full-week totals can depend on entries
    # outside the requested date range or hidden by display filters. Preserve
    # the full weekly ledger dependency so any later correction invalidates the
    # snapshot that was calculated from it.
    dependencies = ledger_dependency_entries(report, employee_ids)
    entries_by_id = dependencies.index_by { |entry| entry.fetch("id") }
    visible_entries.each do |entry|
      id = entry.fetch("id")
      entries_by_id[id] = entries_by_id.fetch(id, {}).merge(entry).merge("snapshot_role" => "report")
    end

    entries_by_id.values.sort_by { |entry| [ entry.fetch("employee_id"), entry.fetch("work_date").to_s, entry.fetch("id") ] }
  end

  private_class_method def self.ledger_dependency_entries(report, employee_ids)
    return [] if employee_ids.empty?

    employee_names = Array(report[:employees]).to_h do |employee|
      [
        (employee[:id] || employee[:source_user_id]).to_i,
        employee[:full_name] || employee[:display_name]
      ]
    end
    context_start = Date.iso8601((report[:context_start_date] || report.fetch(:start_date)).to_s).beginning_of_week(:sunday)
    context_end = Date.iso8601((report[:context_end_date] || report.fetch(:end_date)).to_s).end_of_week(:sunday)

    TimeEntry
      .where(user_id: employee_ids, work_date: context_start..context_end)
      .includes(:time_category, :time_entry_breaks)
      .map do |entry|
        {
          "id" => entry.id,
          "employee_id" => entry.user_id,
          "employee_name" => employee_names[entry.user_id],
          "work_date" => entry.work_date.iso8601,
          "start_time" => entry.start_time&.iso8601,
          "end_time" => entry.end_time&.iso8601,
          "total_hours" => entry.hours.to_f,
          "break_minutes" => entry.break_minutes.to_i,
          "description" => entry.description,
          "entry_method" => entry.entry_method,
          "clock_source" => entry.clock_source,
          "status" => entry.status,
          "approval_status" => entry.approval_status,
          "overtime_status" => entry.overtime_status,
          "approved_at" => entry.approved_at&.iso8601,
          "overtime_approved_at" => entry.overtime_approved_at&.iso8601,
          "time_category" => entry.time_category && {
            "id" => entry.time_category.id,
            "key" => entry.time_category.key,
            "name" => entry.time_category.name
          },
          "breaks" => entry.time_entry_breaks.sort_by(&:start_time).map do |entry_break|
            {
              "id" => entry_break.id,
              "start_time" => entry_break.start_time&.iso8601,
              "end_time" => entry_break.end_time&.iso8601,
              "duration_minutes" => entry_break.duration_minutes
            }
          end,
          "snapshot_role" => "ledger_dependency"
        }
      end
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
