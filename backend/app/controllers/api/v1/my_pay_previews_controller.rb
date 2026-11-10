# frozen_string_literal: true

module Api
  module V1
    # Read-only "preview as a worker" for owners and admins (the preview_pay
    # capability; managers cannot see other people's pay). The target worker is an AIRE user looked
    # up here; their own payroll_integration_uuid and the same ownership check
    # as My Pay decide which statements can be shown. Works while My Pay is off
    # for workers. Every statement access is audited by ID, never by amount.
    class MyPayPreviewsController < BaseController
      NOT_ALLOWED_MESSAGE = "My Pay preview isn't available for your account."
      WORKER_NOT_FOUND_MESSAGE = "We couldn't find that worker."
      AUDIT_UNAVAILABLE_MESSAGE = "Preview is temporarily unavailable because the access log couldn't be written. Please try again."

      # Raised when a preview's audit row can't be written; no data is returned.
      class AuditUnavailable < StandardError; end

      before_action :prevent_caching
      before_action :authenticate_user!
      before_action :require_preview_access!
      before_action :load_worker!, except: :workers

      rescue_from ::Payroll::WorkerStatementsClient::Unavailable, with: :statements_unavailable
      rescue_from ::Payroll::WorkerStatementsClient::NotLinked, with: :not_linked
      rescue_from ::Payroll::WorkerStatementsClient::NotFound, with: :statement_not_found
      rescue_from AuditUnavailable, with: :audit_unavailable

      # GET /api/v1/my_pay/preview/workers
      def workers
        users = previewable_workers.order(:first_name, :last_name, :id).to_a
        sent = PayrollBatchEntry.effective.where(source_user_id: users.map(&:id)).distinct.pluck(:source_user_id).to_set
        render json: { workers: users.map { |user| worker_json(user, sent.include?(user.id)) } }
      end

      # GET /api/v1/my_pay/preview/workers/:user_id
      def worker
        sent = PayrollBatchEntry.effective.exists?(source_user_id: @worker.id)
        render json: { worker: worker_json(@worker, sent) }
      end

      # GET /api/v1/my_pay/preview/workers/:user_id/statements
      def index
        result = statements.list
        audit!("my_pay.preview_statements_viewed", statement_count: result[:statements].size)
        render json: result
      end

      # GET /api/v1/my_pay/preview/workers/:user_id/statements/:id
      def show
        result = statements.detail(params[:id])
        audit!("my_pay.preview_statement_viewed", statement_id: params[:id].to_s)
        render json: result
      end

      # GET /api/v1/my_pay/preview/workers/:user_id/statements/:id/pdf
      def pdf
        result = statements.pdf(params[:id])
        audit!("my_pay.preview_statement_pdf_downloaded", statement_id: params[:id].to_s)
        send_data result.fetch(:body),
          type: "application/pdf",
          disposition: "attachment",
          filename: "AIRE-pay-statement-#{result[:pay_date] || params[:id]}.pdf"
      end

      private

      def previewable_workers
        User.staff.where(is_active: true)
      end

      def worker_json(user, sent_to_payroll)
        { id: user.id, name: user.full_name, role: user.role, sent_to_payroll: sent_to_payroll }
      end

      def statements
        @statements ||= ::Payroll::MyPayStatements.new(user: @worker)
      end

      def require_preview_access!
        return if current_user&.is_active? && current_user.can_preview_pay?

        AuditLog.record_security_event!(action: "authorization.my_pay_preview_denied", actor: current_user, outcome: "denied", metadata: { path: request.path })
        render json: { error: NOT_ALLOWED_MESSAGE, code: "my_pay_preview_not_enabled" }, status: :forbidden
      end

      def load_worker!
        id = params[:user_id].to_s
        @worker = previewable_workers.find_by(id: id) if id.match?(/\A[1-9]\d{0,17}\z/)
        return if @worker

        render json: { error: WORKER_NOT_FOUND_MESSAGE, code: "worker_not_found" }, status: :not_found
      end

      def prevent_caching
        response.headers["Cache-Control"] = "no-store"
      end

      def statements_unavailable(error)
        Rails.logger.warn("[MyPayPreview] #{error.message}")
        audit!(audit_action, outcome: "failed", statement_id: params[:id]&.to_s, raise_on_failure: false)
        render json: { error: MyPayController::UNAVAILABLE_MESSAGE, code: "my_pay_unavailable" }, status: :service_unavailable
      end

      # The same wording the worker would see in My Pay.
      def not_linked(_error)
        audit!(audit_action, outcome: "failed", reason: "payroll_not_linked", statement_id: params[:id]&.to_s, raise_on_failure: false)
        render json: { error: MyPayController::NOT_LINKED_MESSAGE, code: "payroll_not_linked" }, status: :not_found
      end

      def statement_not_found(_error)
        audit!(audit_action, outcome: "denied", reason: "statement_not_owned", statement_id: params[:id].to_s.first(40), raise_on_failure: false)
        render json: { error: MyPayController::NOT_FOUND_MESSAGE, code: "statement_not_found" }, status: :not_found
      end

      def audit_unavailable(_error)
        render json: { error: AUDIT_UNAVAILABLE_MESSAGE, code: "my_pay_unavailable" }, status: :service_unavailable
      end

      def audit_action
        {
          "index" => "my_pay.preview_statements_viewed",
          "show" => "my_pay.preview_statement_viewed",
          "pdf" => "my_pay.preview_statement_pdf_downloaded"
        }.fetch(action_name)
      end

      # The subject is the previewed worker and the actor is the admin, so the
      # worker's own activity history shows who looked. Amounts are never logged.
      # Unlike My Pay, a successful preview fails closed: no audit row, no data.
      def audit!(action, outcome: "succeeded", raise_on_failure: true, **metadata)
        AuditLog.record!(
          action: action,
          auditable: @worker,
          actor: current_user,
          event_category: "payroll",
          outcome: outcome,
          metadata: { viewer_user_id: current_user.id, target_user_id: @worker.id, read_only: true, **metadata }.compact
        )
      rescue StandardError => e
        Rails.logger.error("[MyPayPreview] Failed to audit #{action}: #{e.class}")
        Rails.error.report(e, handled: true, severity: :error, context: { operation: "my_pay_preview_audit", action: action, outcome: outcome })
        raise AuditUnavailable if raise_on_failure
      end
    end
  end
end
