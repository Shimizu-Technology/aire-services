# frozen_string_literal: true

module Api
  module V1
    # "Email me this stub" in My Pay: a secure link to one of the signed-in
    # worker's own stubs, sent to the email on file. Needs My Pay and the
    # "Workers can email themselves stubs" setting, which is off by default.
    class MyPayEmailsController < BaseController
      before_action :prevent_caching
      before_action :authenticate_user!
      before_action :require_staff!
      before_action :require_my_pay!
      before_action :require_self_email!

      rescue_from ::PayDocuments::Error, with: :pay_document_error

      # POST /api/v1/my_pay/:id/email
      def create
        result = ::PayDocuments::LinkSender.send!(worker: current_user, actor: current_user, statement_ids: [ params[:id].to_s ], origin: "self")
        render json: { sent_to: ::PayDocuments.masked_email(result.delivery.recipient_email), expires_at: result.delivery.expires_at.iso8601,
          email_status: result.email_status }, status: :created
      end

      private

      def require_my_pay!
        return if Setting.my_pay_enabled_for?(current_user)

        render json: { error: "My Pay isn't available for your account yet.", code: "my_pay_not_enabled" }, status: :forbidden
      end

      def require_self_email!
        return if ::PayDocuments.self_email_enabled?

        render json: { error: "Emailing yourself pay stubs isn't turned on yet.", code: "self_email_off" }, status: :forbidden
      end

      def prevent_caching
        response.headers["Cache-Control"] = "no-store"
      end

      def pay_document_error(error)
        render json: { error: error.message, code: error.code }, status: error.status
      end
    end
  end
end
