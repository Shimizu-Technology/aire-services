# frozen_string_literal: true

module Api
  module V1
    module PayStubs
      # Workers' pay stub requests, for senders to fulfil or dismiss.
      class RequestsController < BaseController
        RECENT_WINDOW = 30.days

        # GET /api/v1/pay_stubs/requests?status=open|closed
        def index
          requests = PayDocumentRequest.includes(:user, :resolved_by, pay_document_deliveries: [ :user, :sent_by, :revoked_by, :pay_document_items ])
          requests = if params[:status] == "closed"
            requests.where.not(status: "open").where(updated_at: RECENT_WINDOW.ago..).order(resolved_at: :desc, id: :desc).limit(100)
          else
            requests.open_requests.order(:created_at, :id)
          end
          render json: { requests: requests.map { |request| request_json(request) }, open_count: PayDocumentRequest.open_requests.count }
        end

        # POST /api/v1/pay_stubs/requests/:id/dismiss
        def dismiss
          request = PayDocumentRequest.find(params[:id])
          note = params[:note].to_s.strip.first(500).presence
          request.with_lock do
            raise ::PayDocuments::Error.new("That request was already handled.", code: "request_closed", status: :conflict) unless request.open?

            request.update!(status: "dismissed", resolved_by: current_user, resolved_at: Time.current, resolution_note: note)
            AuditLog.record!(action: "pay_documents.request_dismissed", auditable: request, actor: current_user, subject_name: request.user.full_name,
              event_category: "payroll", metadata: { request_id: request.id, target_user_id: request.user_id, has_note: note.present? })
          end
          render json: { request: request_json(request) }
        end

        private

        def request_json(request)
          {
            id: request.id,
            status: request.status,
            source: request.source,
            scope: request.scope,
            statement_id: request.document_reference,
            pay_date: request.document_date&.iso8601,
            year: request.year,
            worker: worker_json(request.user),
            recipient_kind: request.recipient_kind,
            recipient_email: request.recipient_kind == "typed" ? request.recipient_email : ::PayDocuments.on_file_email(request.user),
            requested_at: request.created_at.iso8601,
            resolved_at: request.resolved_at&.iso8601,
            resolved_by: request.resolved_by&.full_name,
            resolution_note: request.resolution_note,
            links: request.pay_document_deliveries.sort_by(&:created_at).reverse.map { |delivery| delivery_json(delivery) }
          }
        end
      end
    end
  end
end
