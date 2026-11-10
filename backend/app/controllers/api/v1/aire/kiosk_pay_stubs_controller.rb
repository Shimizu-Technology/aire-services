# frozen_string_literal: true

module Api
  module V1
    module Aire
      # "Request my pay stub" at the shared kiosk. The worker is the one whose
      # PIN was just verified, using the same kiosk tokens as the clock. The
      # kiosk only ever sees pay dates and a masked email, never amounts.
      # Off until "Pay stub requests at the kiosk" is turned on in Settings.
      class KioskPayStubsController < BaseController
        SENT_MESSAGE = "Your request was sent to the office."

        rescue_from AireKioskService::KioskError, with: :kiosk_error
        rescue_from ::PayDocuments::Error, with: :pay_document_error

        before_action :prevent_caching
        before_action :require_enabled!
        before_action :load_employee!

        # POST /api/v1/aire/kiosk/pay_stubs/choices
        def choices
          catalog = ::PayDocuments::StatementCatalog.new(worker: @employee)
          pay_dates, years, available = begin
            entries = ::PayDocuments.with_payroll { catalog.sendable }
            [ entries.map { |entry| { statement_id: entry.id, pay_date: entry.pay_date } }, catalog.years, true ]
          rescue ::PayDocuments::Error
            # The office can still look the stubs up; offer "latest" and recent years.
            [ [], [ Time.current.year, Time.current.year - 1 ], false ]
          end

          render json: {
            pay_dates: pay_dates,
            years: years.presence || [ Time.current.year ],
            pay_dates_available: available,
            on_file_email_hint: ::PayDocuments.masked_email(::PayDocuments.on_file_email(@employee))
          }
        end

        # POST /api/v1/aire/kiosk/pay_stubs
        def create
          ::PayDocuments::RequestRecorder.record!(
            worker: @employee,
            source: "kiosk",
            scope: params[:scope],
            statement_id: params[:statement_id],
            year: params[:year],
            email: params[:email],
            email_confirmation: params[:email_confirmation]
          )
          render json: { message: SENT_MESSAGE }, status: :created
        end

        private

        def require_enabled!
          return if ::PayDocuments.kiosk_requests_enabled?

          render json: { error: "Pay stub requests aren't available at the kiosk.", code: "kiosk_requests_off" }, status: :not_found
        end

        def load_employee!
          @employee = AireKioskService.employee_from_tokens!(
            kiosk_access_token: params[:kiosk_access_token].to_s,
            kiosk_token: params[:kiosk_token].to_s
          )
        end

        def prevent_caching
          response.headers["Cache-Control"] = "no-store"
        end

        def kiosk_error(error)
          render json: { error: error.message, code: "kiosk_session" }, status: :unprocessable_entity
        end

        def pay_document_error(error)
          if action_name == "create" && @employee
            AuditLog.record!(action: "pay_documents.request_created", auditable: @employee, actor: @employee, event_category: "payroll",
              source: "kiosk", outcome: "denied", metadata: { reason: error.code, scope: params[:scope].to_s.first(20) })
          end
          render json: { error: error.message, code: error.code }, status: error.status
        end
      end
    end
  end
end
