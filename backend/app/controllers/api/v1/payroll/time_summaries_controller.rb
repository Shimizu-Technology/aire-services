# frozen_string_literal: true

module Api
  module V1
    module Payroll
      class TimeSummariesController < ApplicationController
        include SharedSecretAuthenticatable

        before_action :authenticate_shared_secret!

        def show
          report = ::Payroll::TimeSummaryBuilder.new(
            start_date: params[:start_date],
            end_date: params[:end_date]
          ).call
          ReportExport.transaction do
            export = ReportExport.capture!(
              export_type: "payroll_time_summary",
              report: report,
              protects_entries: true,
              deduplicate: true
            )
            report[:export] = {
              id: export.public_id,
              readiness_status: export.readiness_status,
              checksum: export.checksum
            }
            AuditLog.record!(
              action: "payroll.time_summary_pulled",
              auditable: export,
              actor: nil,
              actor_kind: "integration",
              source: "integration",
              event_category: "integration",
              metadata: {
                start_date: report[:start_date],
                end_date: report[:end_date],
                export_reference: export.public_id,
                checksum: export.checksum,
                readiness_status: export.readiness_status
              }
            )
          end
          render json: report
        rescue ArgumentError => e
          render json: { error: e.message }, status: :unprocessable_entity
        rescue StandardError => e
          Rails.logger.error("Payroll time summary failed: #{e.class} - #{e.message}")
          render json: { error: "Internal server error" }, status: :internal_server_error
        end
      end
    end
  end
end
