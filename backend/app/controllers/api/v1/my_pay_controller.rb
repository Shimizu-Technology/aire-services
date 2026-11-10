# frozen_string_literal: true

module Api
  module V1
    # The signed-in worker's own pay statements, read from Cornerstone. The
    # worker is always current_user; no worker identifier is accepted here.
    class MyPayController < BaseController
      UNAVAILABLE_MESSAGE = "Pay history is temporarily unavailable. Please try again in a few minutes."
      NOT_LINKED_MESSAGE = "Your AIRE account isn't connected to payroll yet. Ask an AIRE administrator to connect it."
      NOT_FOUND_MESSAGE = "We couldn't find that paycheck."

      before_action :authenticate_user!
      before_action :require_staff!
      before_action :require_my_pay!
      before_action :prevent_caching

      rescue_from ::Payroll::WorkerStatementsClient::Unavailable, with: :statements_unavailable
      rescue_from ::Payroll::WorkerStatementsClient::NotLinked, with: :not_linked
      rescue_from ::Payroll::WorkerStatementsClient::NotFound, with: :statement_not_found

      # GET /api/v1/my_pay
      def index
        result = statements.list
        record_view!("my_pay.statements_viewed", statement_count: result[:statements].size)
        render json: result
      end

      # GET /api/v1/my_pay/:id
      def show
        result = statements.detail(params[:id])
        record_view!("my_pay.statement_viewed", statement_id: params[:id].to_s)
        render json: result
      end

      # GET /api/v1/my_pay/:id/pdf
      def pdf
        result = statements.pdf(params[:id])
        record_view!("my_pay.statement_pdf_downloaded", statement_id: params[:id].to_s)
        send_data result.fetch(:body),
          type: "application/pdf",
          disposition: "attachment",
          filename: "AIRE-pay-statement-#{result[:pay_date] || params[:id]}.pdf"
      end

      private

      def statements
        @statements ||= ::Payroll::MyPayStatements.new(user: current_user)
      end

      def require_my_pay!
        return if Setting.my_pay_enabled_for?(current_user)

        render json: { error: "My Pay isn't available for your account yet.", code: "my_pay_not_enabled" }, status: :forbidden
      end

      def prevent_caching
        response.headers["Cache-Control"] = "no-store"
      end

      def statements_unavailable(error)
        Rails.logger.warn("[MyPay] #{error.message}")
        record_view!(audit_action, outcome: "failed", statement_id: params[:id]&.to_s)
        render json: { error: UNAVAILABLE_MESSAGE, code: "my_pay_unavailable" }, status: :service_unavailable
      end

      def not_linked(_error)
        record_view!(audit_action, outcome: "failed", reason: "payroll_not_linked", statement_id: params[:id]&.to_s)
        render json: { error: NOT_LINKED_MESSAGE, code: "payroll_not_linked" }, status: :not_found
      end

      def statement_not_found(_error)
        record_view!(audit_action, outcome: "denied", reason: "statement_not_owned", statement_id: params[:id].to_s.first(40))
        render json: { error: NOT_FOUND_MESSAGE, code: "statement_not_found" }, status: :not_found
      end

      def audit_action
        { "index" => "my_pay.statements_viewed", "show" => "my_pay.statement_viewed", "pdf" => "my_pay.statement_pdf_downloaded" }.fetch(action_name)
      end

      # Views are audited by statement ID only; amounts are never logged.
      def record_view!(action, outcome: "succeeded", **metadata)
        AuditLog.record!(
          action: action,
          auditable: current_user,
          actor: current_user,
          event_category: "payroll",
          outcome: outcome,
          metadata: metadata.compact
        )
      rescue StandardError => e
        Rails.logger.warn("[MyPay] Failed to audit #{action}: #{e.class}")
      end
    end
  end
end
