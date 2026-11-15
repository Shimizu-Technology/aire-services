# frozen_string_literal: true

module Api
  module V1
    module PayStubs
      # People a sender can send stubs to, and each person's check dates.
      class WorkersController < BaseController
        # GET /api/v1/pay_stubs/workers
        def index
          workers = ::PayDocuments.sendable_workers.order(:first_name, :last_name, :id)
          render json: { workers: workers.map { |user| worker_json(user) }, can_choose_recipient: can_choose_recipient? }
        end

        # GET /api/v1/pay_stubs/workers/:id
        def show
          render json: { worker: worker_json(find_worker!(params[:id], include_former: true)) }
        end

        # Admin-only direct download; uses the same fresh ownership/void checks
        # and PDF source as a recipient link, without creating an emailed link.
        def pdf
          require_capability!(:manage_payroll)
          return if performed?

          worker = find_worker!(params[:id], include_former: true)
          result = ::PayDocuments.with_payroll do
            client = ::Payroll::WorkerStatementsClient.new
            entry = ::PayDocuments::StatementCatalog.new(worker: worker, client: client).find(params[:statement_id])
            unless entry && !entry.voided
              raise ::PayDocuments::Error.new("That pay stub isn't available.", code: "statement_not_found", status: :not_found)
            end
            { body: client.statement_pdf(worker.payroll_integration_uuid, entry.id), date: entry.pay_date }
          end
          audit_pdf!(worker)
          send_data result.fetch(:body), type: "application/pdf", disposition: "attachment",
            filename: "AIRE-pay-stub-#{result[:date] || params[:statement_id]}.pdf"
        rescue ::PayDocuments::Error => error
          raise if error.code == "audit_unavailable"

          audit_pdf!(worker, outcome: error.code == "payroll_unavailable" ? "failed" : "denied", reason: error.code, raise_on_failure: false)
          if error.code == "payroll_not_linked" && worker
            raise ::PayDocuments::Error.new("#{worker.full_name} isn't connected to payroll yet, so there are no pay stubs to download.", code: error.code, status: error.status)
          end
          raise
        end

        # GET /api/v1/pay_stubs/workers/:id/statements
        # Pay dates and periods only, never amounts, so managers can pick stubs.
        # The run purpose (a bonus run, say) is for owners and admins only.
        def statements
          catalog = ::PayDocuments::StatementCatalog.new(worker: find_worker!(params[:id], include_former: true))
          entries = ::PayDocuments.with_payroll { catalog.entries }
          rows = entries.map(&:as_json)
          rows = rows.map { |row| row.except(:run_purpose) } unless current_user.can_preview_pay?
          render json: { statements: rows }
        end
        private

        def audit_pdf!(worker, outcome: "succeeded", raise_on_failure: true, **metadata)
          AuditLog.record!(action: "pay_documents.admin_pdf_downloaded", auditable: worker || current_user, actor: current_user,
            subject_name: worker&.full_name, event_category: "payroll", outcome: outcome,
            metadata: { target_user_id: worker&.id, statement_id: params[:statement_id].to_s.first(40), accessed_by: "admin", **metadata }.compact)
        rescue StandardError => error
          Rails.logger.error("[PayStubs] Failed to audit admin PDF download: #{error.class}")
          Rails.error.report(error, handled: true, severity: :error, context: { operation: "pay_stub_admin_pdf_audit", outcome: outcome })
          return unless raise_on_failure

          raise ::PayDocuments::Error.new("The pay stub couldn't be downloaded because the access log couldn't be written. Please try again.",
            code: "audit_unavailable", status: :service_unavailable)
        end
      end
    end
  end
end
