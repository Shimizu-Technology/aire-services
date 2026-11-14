# frozen_string_literal: true

require "prawn"
require "prawn/table"

module Reports
  class EmployeeTimesheetPdf
    BUSINESS_TIMEZONE = TimeClockService::BUSINESS_TIMEZONE
    NAVY = "14324B"
    CYAN = "0E7490"
    LIGHT_CYAN = "ECFEFF"
    GREEN = "047857"
    LIGHT_GREEN = "ECFDF5"
    AMBER = "92400E"
    LIGHT_AMBER = "FFFBEB"
    BORDER = "D6DEE3"
    MUTED = "5F6F78"

    def initialize(report:, export:, generated_by:)
      @report = report
      @export = export
      @employee = Array(report[:employees]).first
      @generated_by = generated_by
    end

    def render
      Prawn::Document.new(page_size: "LETTER", margin: [ 42, 36, 48, 36 ], info: metadata) do |pdf|
        PdfTypography.apply(pdf)
        render_header(pdf)
        render_identity(pdf)
        render_status(pdf)
        render_entries(pdf)
        render_weekly_totals(pdf)
        render_grand_totals(pdf)
        render_notes(pdf)
        render_footer(pdf)
      end.render
    end

    private

    attr_reader :report, :export, :employee, :generated_by

    def metadata
      {
        Title: "AIRE Employee Timesheet - #{employee[:full_name]}",
        Author: "AIRE Services",
        Subject: "Employee time entries from #{report[:start_date]} to #{report[:end_date]}",
        Creator: "AIRE Operations"
      }
    end

    def render_header(pdf)
      top = pdf.cursor
      pdf.fill_color NAVY
      pdf.text_box "AIRE", at: [ 0, top ], width: 150, height: 28, size: 25, style: :bold, character_spacing: 1.2
      pdf.text_box "EMPLOYEE TIMESHEET", at: [ 260, top - 4 ], width: 280, height: 22, align: :right, size: 15, style: :bold
      pdf.move_down 32
      pdf.stroke_color CYAN
      pdf.line_width 2
      pdf.stroke_horizontal_rule
      pdf.move_down 5
      pdf.fill_color MUTED
      pdf.text contact_line, size: 6.8, align: :right
      pdf.move_down 10
    end

    def render_identity(pdf)
      details = [
        [ label("Employee"), value(employee[:full_name]), label("Period"), value("#{format_date(report[:start_date])} to #{format_date(report[:end_date])}") ],
        [ label("Generated"), value(generated_time), label("Reference"), value(export.public_id) ]
      ]
      pdf.table(details, width: pdf.bounds.width, column_widths: [ 76, 194, 76, 194 ], cell_style: { borders: [], padding: [ 2, 0, 5, 0 ], size: 9 })
      pdf.move_down 8
    end

    def render_status(pdf)
      HoursReportDisclosure.new(report: report, export: export).render(pdf)
    end

    def render_entries(pdf)
      pdf.fill_color NAVY
      pdf.text "Time Entries", size: 12, style: :bold
      pdf.move_down 6

      rows = [ [ "Date", "Start", "End", "Break", "Category", "Approved regular", "Approved OT", "Approved for payroll", "OT waiting (not included)" ] ]
      Array(employee[:days]).each do |day|
        Array(day[:entries]).each do |entry|
          rows << [
            format_date(entry[:work_date]),
            entry[:formatted_start_time] || "Open",
            entry[:formatted_end_time] || "Open",
            entry[:break_minutes].to_i.zero? ? "-" : "#{entry[:break_minutes]}m",
            entry.dig(:time_category, :name) || "Uncategorized",
            hours(entry.dig(:payroll_hours, :approved_regular_hours)),
            hours(entry.dig(:payroll_hours, :approved_overtime_hours)),
            hours(entry.dig(:payroll_hours, :approved_hours)),
            hours(entry.dig(:payroll_hours, :overtime_waiting_hours))
          ]
        end
      end
      rows << [ { content: "No included entries for this period.", colspan: 9 } ] if rows.one?

      pdf.table(rows, header: true, width: pdf.bounds.width, column_widths: [ 55, 45, 45, 35, 100, 60, 60, 65, 65 ], cell_style: { size: 7.5, padding: [ 6, 4 ], border_color: BORDER }) do |table|
        table.row_colors = [ "FFFFFF", "F7FAFB" ] if rows.length > 2
        table.row(0).background_color = NAVY
        table.row(0).text_color = "FFFFFF"
        table.row(0).font_style = :bold
        table.columns(5..8).align = :right
      end
      pdf.move_down 16
    end

    def render_weekly_totals(pdf)
      weeks = Array(employee[:weeks])
      return if weeks.empty?

      pdf.fill_color NAVY
      pdf.text "Weekly Totals", size: 11, style: :bold
      pdf.move_down 5
      rows = [ [ "Week", "Approved for payroll", "Approved regular", "Approved overtime", "Full week worked hours" ] ]
      weeks.each do |week|
        rows << [
          "#{format_date(week[:week_start])} to #{format_date(week[:week_end])}",
          hours(week.dig(:payroll_hours, :approved_hours)),
          hours(week.dig(:payroll_hours, :approved_regular_hours)),
          hours(week.dig(:payroll_hours, :approved_overtime_hours)),
          hours(week[:weekly_total_hours])
        ]
      end
      pdf.table(rows, header: true, width: pdf.bounds.width, cell_style: { size: 8, padding: [ 5, 5 ], border_color: BORDER }) do |table|
        table.row(0).background_color = LIGHT_CYAN
        table.row(0).text_color = NAVY
        table.row(0).font_style = :bold
        table.columns(1..4).align = :right
      end
      pdf.move_down 14
    end

    def render_grand_totals(pdf)
      rows = [
        [ "Approved regular", "Approved overtime", "Approved for payroll", "Time waiting for approval", "Overtime waiting for approval — not included" ],
        [ hours(employee.dig(:payroll_hours, :approved_regular_hours)), hours(employee.dig(:payroll_hours, :approved_overtime_hours)), hours(employee.dig(:payroll_hours, :approved_hours)), hours(employee.dig(:payroll_hours, :time_waiting_hours)), hours(employee.dig(:payroll_hours, :overtime_waiting_hours)) ]
      ]
      pdf.table(rows, width: pdf.bounds.width, cell_style: { align: :center, padding: [ 8, 5 ], border_color: BORDER }) do |table|
        table.row(0).background_color = NAVY
        table.row(0).text_color = "FFFFFF"
        table.row(0).font_style = :bold
        table.row(0).size = 8
        table.row(1).text_color = CYAN
        table.row(1).font_style = :bold
        table.row(1).size = 13
      end
      pdf.move_down 13
    end

    def render_notes(pdf)
      pdf.fill_color MUTED
      pdf.text "Waiting hours are not included in payroll totals. Hours are net of recorded breaks. Overtime is allocated after 40.00 hours in each Sunday-Saturday workweek. This document is a point-in-time report and does not require a finalized-week lock.", size: 7.5, leading: 2
      pdf.move_down 5
      pdf.text "Generated by #{generated_by.full_name} through AIRE Operations.", size: 7.5
    end

    def render_footer(pdf)
      pdf.number_pages "AIRE Services  |  #{export.public_id}  |  Page <page> of <total>", at: [ 0, -28 ], width: pdf.bounds.width, align: :center, size: 7, color: MUTED
    end


    def generated_time
      export.generated_at.in_time_zone(BUSINESS_TIMEZONE).strftime("%b %-d, %Y at %-I:%M %p %Z")
    end

    def contact_line
      contact = Setting.public_contact_settings
      address = [ contact["street_address"], contact["address_area_label"], contact["address_region"], contact["postal_code"] ].compact_blank.join(", ")
      [ address, contact["phone_display"], contact["email"] ].compact_blank.join(" | ")
    end

    def format_date(value)
      Date.iso8601(value.to_s).strftime("%b %-d, %Y")
    end

    def hours(value)
      format("%.2f", value.to_f)
    end

    def label(text)
      { content: text, text_color: MUTED, font_style: :bold }
    end

    def value(text)
      { content: text.to_s, text_color: NAVY }
    end
  end
end
