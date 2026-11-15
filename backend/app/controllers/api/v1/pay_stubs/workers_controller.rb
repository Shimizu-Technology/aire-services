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
          AuditLog.record!(action: "pay_documents.link_downloaded", auditable: worker, actor: current_user,
            subject_name: worker.full_name, event_category: "payroll", outcome: "succeeded",
            metadata: { target_user_id: worker.id, statement_id: params[:statement_id], accessed_by: "admin" })
          send_data result.fetch(:body), type: "application/pdf", disposition: "attachment",
            filename: "AIRE-pay-stub-#{result[:date] || params[:statement_id]}.pdf"
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
      end
    end
  end
end
