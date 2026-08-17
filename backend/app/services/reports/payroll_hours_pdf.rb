# frozen_string_literal: true

require "prawn"
require "prawn/table"

module Reports
  class PayrollHoursPdf
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
    SOFT_ROW = "F7FAFB"

    def initialize(report:, export:, generated_by:)
      @report = report
      @export = export
      @generated_by = generated_by
    end

    def render
      Prawn::Document.new(page_size: "LETTER", page_layout: :landscape, margin: [ 38, 36, 46, 36 ], info: metadata) do |pdf|
        render_header(pdf, "PAYROLL HOURS REPORT")
        render_identity(pdf)
        render_status(pdf)
        render_summary(pdf)
        render_employee_summary(pdf)
        render_notes(pdf)
        render_employee_pages(pdf)
        render_footer(pdf)
      end.render
    end

    private

    attr_reader :report, :export, :generated_by

    def metadata
      {
        Title: "AIRE Payroll Hours Report",
        Author: "AIRE Services",
        Subject: "Payroll hours from #{report[:start_date]} to #{report[:end_date]}",
        Creator: "AIRE Operations"
      }
    end

    def render_header(pdf, title)
      top = pdf.cursor
      pdf.fill_color NAVY
      pdf.text_box "AIRE", at: [ 0, top ], width: 150, height: 28, size: 25, style: :bold, character_spacing: 1.2
      pdf.text_box title, at: [ 350, top - 4 ], width: 370, height: 22, align: :right, size: 15, style: :bold
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
        [ label("Period"), value("#{format_date(report[:start_date])} to #{format_date(report[:end_date])}"), label("Generated"), value(generated_time) ],
        [ label("Employees"), value(summary[:employee_count]), label("Reference"), value(export.public_id) ]
      ]
      pdf.table(details, width: pdf.bounds.width, column_widths: [ 75, 285, 75, 285 ], cell_style: { borders: [], padding: [ 2, 0, 5, 0 ], size: 9 })
      pdf.move_down 8
    end

    def render_status(pdf)
      complete = export.readiness_status == "complete"
      fill = complete ? LIGHT_GREEN : LIGHT_AMBER
      color = complete ? GREEN : AMBER
      title = complete ? "Complete as of #{generated_time}" : "Draft - needs review"
      detail = complete ? "No pending, denied, or open time entries were found in this period." : issue_summary

      pdf.fill_color fill
      pdf.fill_rounded_rectangle [ 0, pdf.cursor ], pdf.bounds.width, 42, 6
      pdf.fill_color color
      pdf.text_box title, at: [ 12, pdf.cursor - 10 ], width: pdf.bounds.width - 24, height: 15, size: 10, style: :bold
      pdf.fill_color MUTED
      pdf.text_box detail, at: [ 12, pdf.cursor - 24 ], width: pdf.bounds.width - 24, height: 14, size: 7.5
      pdf.move_down 52
    end

    def render_summary(pdf)
      rows = [
        [ "Total Hours", "Regular", "Overtime", "Break Hours", "Employees", "Entries" ],
        [ hours(summary[:total_hours]), hours(summary[:regular_hours]), hours(summary[:overtime_hours]), hours(summary[:break_hours]), summary[:employee_count].to_i.to_s, summary[:entries_count].to_i.to_s ]
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
      pdf.move_down 16
    end

    def render_employee_summary(pdf)
      pdf.fill_color NAVY
      pdf.text "Hours by Employee", size: 12, style: :bold
      pdf.move_down 6

      rows = [ [ "Employee", "Department", "Type", "Regular", "OT", "Total", "Break", "Entries" ] ]
      employees.each do |employee|
        rows << [
          employee[:full_name],
          department(employee),
          employee[:employee_type],
          hours(employee[:regular_hours]),
          hours(employee[:overtime_hours]),
          hours(employee[:total_hours]),
          hours(employee[:break_hours]),
          employee[:entries_count].to_i.to_s
        ]
      end
      rows << [ { content: "No matching employees or time entries for this report.", colspan: 8 } ] if employees.empty?

      pdf.table(rows, header: true, width: pdf.bounds.width, column_widths: [ 190, 125, 80, 65, 65, 65, 60, 70 ], cell_style: { size: 8, padding: [ 6, 5 ], border_color: BORDER }) do |table|
        table.row_colors = [ "FFFFFF", SOFT_ROW ] if rows.length > 2
        table.row(0).background_color = LIGHT_CYAN
        table.row(0).text_color = NAVY
        table.row(0).font_style = :bold
        table.columns(3..7).align = :right
      end
      pdf.move_down 14
    end

    def render_notes(pdf)
      pdf.fill_color MUTED
      pdf.text "The following pages provide an employee-by-employee time-entry breakdown. Hours are net of recorded breaks. Overtime is allocated after 40.00 hours in each Sunday-Saturday workweek.", size: 7.5, leading: 2
      pdf.move_down 4
      pdf.text "This point-in-time report does not require a finalized-week lock. Generated by #{generated_by.full_name} through AIRE Operations.", size: 7.5
    end

    def render_employee_pages(pdf)
      employees.each do |employee|
        pdf.start_new_page
        pdf.move_cursor_to pdf.bounds.top
        render_header(pdf, "EMPLOYEE DETAIL")
        render_employee_identity(pdf, employee)
        render_employee_entries(pdf, employee)
        render_weekly_totals(pdf, employee)
        render_employee_totals(pdf, employee)
      end
    end

    def render_employee_identity(pdf, employee)
      pdf.fill_color NAVY
      pdf.text employee[:full_name].to_s, size: 16, style: :bold
      pdf.move_down 3
      pdf.fill_color MUTED
      pdf.text [ department(employee), employee[:employee_type], employee[:status].to_s.capitalize ].compact_blank.join("  |  "), size: 8
      pdf.move_down 12
    end

    def render_employee_entries(pdf, employee)
      rows = [ [ "Date", "Start", "End", "Break", "Category", "Source", "Approval", "Regular", "OT", "Total" ] ]
      Array(employee[:days]).each do |day|
        Array(day[:entries]).each do |entry|
          rows << [
            format_date(entry[:work_date]),
            entry[:formatted_start_time] || "Open",
            entry[:formatted_end_time] || "Open",
            entry[:break_minutes].to_i.zero? ? "-" : "#{entry[:break_minutes]}m",
            entry.dig(:time_category, :name) || "Uncategorized",
            entry[:clock_source].to_s.presence&.upcase || "LEGACY",
            entry[:approval_status].to_s.presence&.capitalize || "Standard",
            hours(entry[:regular_hours]),
            hours(entry[:overtime_hours]),
            hours(entry[:total_hours])
          ]
        end
      end
      rows << [ { content: "No included entries for this employee and period.", colspan: 10 } ] if rows.one?

      pdf.table(rows, header: true, width: pdf.bounds.width, column_widths: [ 60, 50, 50, 42, 230, 65, 72, 52, 45, 54 ], cell_style: { size: 7.2, padding: [ 5, 4 ], border_color: BORDER }) do |table|
        table.row_colors = [ "FFFFFF", SOFT_ROW ] if rows.length > 2
        table.row(0).background_color = NAVY
        table.row(0).text_color = "FFFFFF"
        table.row(0).font_style = :bold
        table.columns(7..9).align = :right
      end
      pdf.move_down 14
    end

    def render_weekly_totals(pdf, employee)
      weeks = Array(employee[:weeks])
      return if weeks.empty?

      pdf.fill_color NAVY
      pdf.text "Weekly Totals", size: 10, style: :bold
      pdf.move_down 5
      rows = [ [ "Week", "Hours in Period", "Regular", "Overtime", "Full Week Total" ] ]
      weeks.each do |week|
        rows << [
          "#{format_date(week[:week_start])} to #{format_date(week[:week_end])}",
          hours(week[:period_hours]),
          hours(week[:regular_hours]),
          hours(week[:overtime_hours]),
          hours(week[:weekly_total_hours])
        ]
      end
      pdf.table(rows, header: true, width: pdf.bounds.width, cell_style: { size: 7.5, padding: [ 5, 5 ], border_color: BORDER }) do |table|
        table.row(0).background_color = LIGHT_CYAN
        table.row(0).text_color = NAVY
        table.row(0).font_style = :bold
        table.columns(1..4).align = :right
      end
      pdf.move_down 12
    end

    def render_employee_totals(pdf, employee)
      rows = [
        [ "Regular Hours", "Overtime Hours", "Total Hours", "Break Hours", "Entries" ],
        [ hours(employee[:regular_hours]), hours(employee[:overtime_hours]), hours(employee[:total_hours]), hours(employee[:break_hours]), employee[:entries_count].to_i.to_s ]
      ]
      pdf.table(rows, width: pdf.bounds.width, cell_style: { align: :center, padding: [ 7, 5 ], border_color: BORDER }) do |table|
        table.row(0).background_color = NAVY
        table.row(0).text_color = "FFFFFF"
        table.row(0).font_style = :bold
        table.row(0).size = 7.5
        table.row(1).text_color = CYAN
        table.row(1).font_style = :bold
        table.row(1).size = 11
      end
    end

    def render_footer(pdf)
      pdf.number_pages "AIRE Services  |  #{export.public_id}  |  Page <page> of <total>", at: [ 0, -28 ], width: pdf.bounds.width, align: :center, size: 7, color: MUTED
    end

    def employees
      @employees ||= Array(report[:employees])
    end

    def summary
      report[:summary] || {}
    end

    def issue_summary
      labels = {
        pending_count: "pending approval",
        denied_count: "denied",
        pending_overtime_count: "pending overtime review",
        denied_overtime_count: "denied overtime",
        open_clock_count: "open clock"
      }
      details = labels.filter_map { |key, text| "#{summary[key]} #{text}" if summary[key].to_i.positive? }
      details.presence&.join(", ") || "Review the selected entries before using this report."
    end

    def department(employee)
      Array(employee[:approval_group_labels]).presence&.join(", ") || employee[:approval_group_label].presence || "Unassigned"
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
