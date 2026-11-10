# frozen_string_literal: true

module Api
  module V1
    # The public page behind an emailed pay stub link. There is no sign-in:
    # the link token is the credential, and it arrives in the request body
    # (never the URL) so it stays out of server logs. Responses show only
    # the employer, the worker's first name, pay dates and downloads left.
    class PayStubLinksController < BaseController
      before_action :prevent_caching

      rescue_from ::PayDocuments::Error, with: :pay_document_error

      # POST /api/v1/pay_stub_links/lookup
      def lookup
        render json: access.summary
      end

      # POST /api/v1/pay_stub_links/download
      def download
        result = access.download!(params[:document_id])
        send_pdf(result)
      end

      # POST /api/v1/pay_stub_links/download_all
      def download_all
        send_pdf(access.download_all!)
      end

      private

      def access
        @access ||= ::PayDocuments::LinkAccess.new(token: params[:token])
      end

      def send_pdf(result)
        send_data result.fetch(:body), type: "application/pdf", disposition: "attachment", filename: result.fetch(:filename)
      end

      def prevent_caching
        response.headers["Cache-Control"] = "no-store"
        response.headers["Referrer-Policy"] = "no-referrer"
      end

      def pay_document_error(error)
        render json: { error: error.message, code: error.code }, status: error.status
      end
    end
  end
end
