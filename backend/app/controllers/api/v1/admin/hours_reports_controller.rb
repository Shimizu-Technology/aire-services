# frozen_string_literal: true

module Api
  module V1
    module Admin
      class HoursReportsController < BaseController
        REPORT_PARAM_KEYS = %i[
          start_date
          end_date
          user_id
          role
          status
          approval_group
          time_category_id
          clock_source
          entry_method
          approval_status
          overtime_status
          include_empty
        ].freeze

        before_action :authenticate_user!
        before_action :require_admin!

        def show
          render json: ::Payroll::HoursReportBuilder.new(report_params).call
        rescue ArgumentError => e
          render json: { error: e.message }, status: :unprocessable_entity
        end

        # PDF is the primary human-readable export. A selected employee gets
        # the official full-ledger timesheet; the default all-employee view
        # gets a consolidated payroll report matching the visible filters.
        def pdf
          if params[:user_id].present?
            report = build_timesheet_report
            return if performed?

            send_employee_timesheet(report)
          else
            report = build_report
            return if performed? || !draft_acknowledged?(report)

            pdf = ReportExport.transaction do
              export = capture_export("payroll_hours_pdf", report)
              Reports::PayrollHoursPdf.new(report: report, export: export, generated_by: current_user).render
            end
            send_data pdf,
                      filename: "AIRE_Payroll_Hours_#{report[:start_date]}_to_#{report[:end_date]}.pdf",
                      type: "application/pdf",
                      disposition: "attachment"
          end
        end

        def timesheet_pdf
          unless params[:user_id].present?
            return render json: { error: "Select exactly one employee to download a timesheet PDF" }, status: :unprocessable_entity
          end

          report = build_timesheet_report
          return if performed?

          send_employee_timesheet(report)
        end

        def detailed_csv
          report = build_report
          return if performed? || !draft_acknowledged?(report)

          csv = ReportExport.transaction do
            export = capture_export("detailed_entries_csv", report)
            Reports::HoursReportCsv.detailed(report: report, export: export)
          end
          send_data csv,
                    filename: "AIRE_Detailed_Time_#{report[:start_date]}_to_#{report[:end_date]}.csv",
                    type: "text/csv; charset=utf-8",
                    disposition: "attachment"
        end

        def summary_csv
          report = build_report
          return if performed? || !draft_acknowledged?(report)

          csv = ReportExport.transaction do
            export = capture_export("payroll_summary_csv", report)
            Reports::HoursReportCsv.summary(report: report, export: export)
          end
          send_data csv,
                    filename: "AIRE_Payroll_Summary_#{report[:start_date]}_to_#{report[:end_date]}.csv",
                    type: "text/csv; charset=utf-8",
                    disposition: "attachment"
        end

        private

        def report_params
          REPORT_PARAM_KEYS.index_with { |key| params[key] }.compact
        end

        def build_report
          ::Payroll::HoursReportBuilder.new(report_params).call
        rescue ArgumentError => e
          render json: { error: e.message }, status: :unprocessable_entity
          nil
        end

        # An employee timesheet is the full point-in-time ledger for the chosen
        # person and date range. Display filters such as category or source must
        # never silently remove otherwise countable entries from the document.
        def build_timesheet_report
          ::Payroll::HoursReportBuilder.new(
            start_date: params[:start_date],
            end_date: params[:end_date],
            user_id: params[:user_id],
            approval_status: "approved_or_standard"
          ).call
        rescue ArgumentError => e
          render json: { error: e.message }, status: :unprocessable_entity
          nil
        end

        def draft_acknowledged?(report)
          return true if report[:ready]
          return true if ActiveModel::Type::Boolean.new.cast(params[:acknowledge_draft])

          render json: {
            error: "This report still has entries that need review. Confirm a draft export to continue.",
            code: "draft_acknowledgement_required",
            issues: report[:summary].slice(:pending_count, :denied_count, :pending_overtime_count, :denied_overtime_count, :open_clock_count)
          }, status: :unprocessable_entity
          false
        end

        def capture_export(export_type, report)
          ReportExport.capture!(
            export_type: export_type,
            report: report,
            generated_by: current_user,
            protects_entries: true
          )
        end

        def send_employee_timesheet(report)
          if report[:employees].length != 1
            render json: { error: "Select exactly one employee to download a timesheet PDF" }, status: :unprocessable_entity
            return
          end
          return unless draft_acknowledged?(report)

          employee = report[:employees].first
          pdf = ReportExport.transaction do
            export = capture_export("employee_timesheet_pdf", report)
            Reports::EmployeeTimesheetPdf.new(report: report, export: export, generated_by: current_user).render
          end
          send_data pdf,
                    filename: "AIRE_Timesheet_#{safe_filename(employee[:full_name])}_#{report[:start_date]}_to_#{report[:end_date]}.pdf",
                    type: "application/pdf",
                    disposition: "attachment"
        end

        def safe_filename(value)
          value.to_s.gsub(/[^A-Za-z0-9]+/, "_").gsub(/\A_+|_+\z/, "").presence || "Employee"
        end
      end
    end
  end
end
