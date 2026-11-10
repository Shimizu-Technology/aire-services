# frozen_string_literal: true

module Api
  module V1
    module PayStubs
      # Sending, listing and revoking secure pay stub links.
      class LinksController < BaseController
        # GET /api/v1/pay_stubs/links?user_id=
        def index
          links = PayDocumentDelivery.includes(:user, :sent_by, :revoked_by, :pay_document_items).recent_first.limit(50)
          links = links.where(user: find_worker!(params[:user_id])) if params[:user_id].present?
          render json: { links: links.map { |delivery| delivery_json(delivery) } }
        end

        # POST /api/v1/pay_stubs/links
        def create
          worker = find_worker!(params[:user_id])
          request = params[:request_id].present? ? PayDocumentRequest.find(params[:request_id]) : nil
          result = ::PayDocuments::LinkSender.send!(
            worker: worker,
            actor: current_user,
            statement_ids: Array(params[:statement_ids]),
            email: params[:email],
            email_confirmation: params[:email_confirmation],
            request: request
          )
          render json: { link: delivery_json(result.delivery.reload), email_status: result.email_status }, status: :created
        end

        # POST /api/v1/pay_stubs/links/:id/revoke
        def revoke
          delivery = ::PayDocuments::LinkRevoker.revoke!(delivery: PayDocumentDelivery.find(params[:id]), actor: current_user)
          render json: { link: delivery_json(delivery.reload) }
        end
      end
    end
  end
end
