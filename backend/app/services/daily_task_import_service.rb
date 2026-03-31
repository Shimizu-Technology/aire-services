# frozen_string_literal: true

class DailyTaskImportService
  ADMIN_EMAIL = ENV.fetch("DEFAULT_ADMIN_EMAIL", "dmshimizucpa@gmail.com").freeze

  HEADER_ALIASES = {
    "client" => %w[client client\ name name],
    "form_service" => %w[form/service form form\ service service form/svc],
    "comments" => %w[comments comment notes note],
    "staff" => %w[staff assigned\ to assigned preparer],
    "reviewed_by" => %w[reviewed\ by reviewed reviewer],
    "status" => %w[status],
  }.freeze

  STATUS_MAP = {
    "1 - Not Started" => "not_started",
    "2 - In Progress" => "in_progress",
    "3 - DMS Reviewing" => "dms_reviewing",
    "4 - Ready to collate/prep for filing" => "ready_to_file",
    "4 - Ready to File" => "ready_to_file",
    "5 - Ready for Client Signature" => "ready_for_signature",
    "5 - Ready for Signature" => "ready_for_signature",
    "6 - Completed" => "completed",
    "7 - Completed - Filed with DRT" => "filed_with_drt",
    "7 - Filed with DRT" => "filed_with_drt",
    "8 - Completed - Filed with IRS" => "filed_with_irs",
    "8 - Filed with IRS" => "filed_with_irs",
    "9 - Pending Information" => "pending_info",
    "9 - Pending Info" => "pending_info",
    "9 - Other" => "other",
    "10 - Other" => "other",
    "Done" => "done",
  }.freeze

  MAX_HEADER_SCAN_ROWS = 15

  class ImportError < StandardError; end

  def initialize(file, user:)
    @file = file
    @user = user
    @staff_map = build_staff_map
  end

  def preview
    raw_rows, sheet_name = parse_rows

    resolved = raw_rows.map do |row|
      assigned = resolve_staff(row["staff"])
      reviewed = resolve_staff(row["reviewed_by"])
      status = resolve_status(row["status"])

      {
        client: row["client"].presence || "",
        form_service: row["form_service"].presence || "",
        comments: row["comments"].presence || "",
        staff_text: row["staff"].presence || "",
        staff_id: assigned&.id,
        reviewed_by_text: row["reviewed_by"].presence || "",
        reviewed_by_id: reviewed&.id,
        status_text: row["status"].presence || "",
        resolved_status: status,
      }
    end

    { rows: resolved, sheet_name: sheet_name }
  end

  def import!(task_date:, rows:)
    created = []

    ActiveRecord::Base.transaction do
      base_position = DailyTask.for_date(task_date).maximum(:position) || -1

      rows.each do |row|
        title = row["client"].presence
        next if title.blank?

        status = row["resolved_status"].presence || "not_started"
        status = "not_started" unless DailyTask::STATUSES.include?(status)

        assigned_id = row["staff_id"].presence
        reviewed_id = row["reviewed_by_id"].presence

        task = DailyTask.create!(
          title: title,
          task_date: task_date,
          position: base_position + created.size + 1,
          status: status,
          priority: "normal",
          form_service: row["form_service"].presence,
          comments: row["comments"].presence,
          assigned_to_id: assigned_id,
          reviewed_by_id: reviewed_id,
          created_by: @user,
          status_changed_by: @user,
          status_changed_at: Time.current,
          completed_at: DailyTask::DONE_STATUSES.include?(status) ? Time.current : nil,
          completed_by: DailyTask::DONE_STATUSES.include?(status) ? @user : nil,
        )
        created << task
      end

      created.each do |task|
        AuditLog.log(
          auditable: task,
          action: "created",
          user: @user,
          metadata: "Imported daily task from spreadsheet: #{task.title}"
        )
      end
    end

    { created: created }
  end

  private

  def parse_rows
    spreadsheet = open_spreadsheet

    best_sheet = nil
    best_header_row = nil
    best_col_map = nil
    best_match_count = 0

    spreadsheet.sheets.each do |sheet_name|
      spreadsheet.default_sheet = sheet_name
      next if spreadsheet.last_row.nil? || spreadsheet.last_row < 2

      header_row_num, col_map = find_header_row(spreadsheet)
      next unless col_map&.key?("client")

      match_count = col_map.size
      if match_count > best_match_count
        best_match_count = match_count
        best_sheet = sheet_name
        best_header_row = header_row_num
        best_col_map = col_map
      end
    end

    unless best_col_map&.key?("client")
      sheets_tried = spreadsheet.sheets.join(", ")
      raise ImportError, "Could not find a 'Client' column header in any sheet. " \
                         "Sheets scanned: #{sheets_tried}. " \
                         "Make sure your spreadsheet has a header row with a 'Client' column."
    end

    spreadsheet.default_sheet = best_sheet
    rows = []
    ((best_header_row + 1)..spreadsheet.last_row).each do |i|
      raw = spreadsheet.row(i)
      row = {}
      best_col_map.each do |field, col_idx|
        row[field] = raw[col_idx]&.to_s&.strip
      end
      next if row.values.all?(&:blank?)
      rows << row
    end

    [rows, best_sheet]
  end

  def find_header_row(spreadsheet)
    scan_limit = [spreadsheet.last_row, MAX_HEADER_SCAN_ROWS].min

    (1..scan_limit).each do |row_num|
      raw_row = spreadsheet.row(row_num)
      col_map = map_columns(raw_row)
      return [row_num, col_map] if col_map.key?("client")
    end

    [nil, nil]
  end

  def open_spreadsheet
    case File.extname(@file.original_filename).downcase
    when ".xlsx", ".xls"
      Roo::Spreadsheet.open(@file.path)
    when ".csv"
      Roo::CSV.new(@file.path)
    else
      raise ImportError, "Unsupported file format. Please upload .xlsx, .xls, or .csv"
    end
  end

  def map_columns(header_row)
    col_map = {}
    return col_map if header_row.nil?

    header_row.each_with_index do |cell, idx|
      next if cell.blank?
      normalized = cell.to_s.strip.downcase
      HEADER_ALIASES.each do |field, aliases|
        if aliases.include?(normalized) && !col_map.key?(field)
          col_map[field] = idx
        end
      end
    end
    col_map
  end

  def build_staff_map
    map = {}
    collided_first_names = Set.new
    User.staff.each do |u|
      key = u.first_name&.downcase
      if key.present?
        if map.key?(key)
          collided_first_names << key
        else
          map[key] = u
        end
      end
      map[u.full_name&.downcase] = u
    end
    collided_first_names.each { |k| map.delete(k) }
    dms_user = User.find_by(email: ADMIN_EMAIL)
    map["dms"] = dms_user if dms_user
    map
  end

  def resolve_staff(name)
    return nil if name.blank?
    @staff_map[name.to_s.strip.downcase]
  end

  def resolve_status(raw)
    return "not_started" if raw.blank?
    STATUS_MAP[raw.to_s.strip] || begin
      match = DailyTask::STATUSES.find { |s| s == raw.to_s.strip.downcase.tr(" ", "_") }
      match || "not_started"
    end
  end
end
