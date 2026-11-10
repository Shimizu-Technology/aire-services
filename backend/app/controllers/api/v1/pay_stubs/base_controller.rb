# frozen_string_literal: true

module Api
  module V1
    module PayStubs
      # Senders' pay stub tools: owners, admins and managers with the
      # send_pay_statements capability. Nothing here returns pay amounts.
      class BaseController < Api::V1::BaseController
        before_action :prevent_caching
        before_action -> { require_capability!(:send_pay_statements) }

        rescue_from ::PayDocuments::Error, with: :pay_document_error

        private

        def prevent_caching
          response.headers["Cache-Control"] = "no-store"
        end

        def pay_document_error(error)
          render json: { error: error.message, code: error.code }, status: error.status
        end

        def find_worker!(id)
          worker = ::PayDocuments.sendable_workers.find_by(id: id) if id.to_s.match?(/\A[1-9]\d{0,17}\z/)
          return worker if worker

          raise ::PayDocuments::Error.new("We couldn't find that person.", code: "worker_not_found", status: :not_found)
        end

        # Managers send only to the address on file, so they see it masked.
        # Owners and admins see it in full and may type another address.
        def worker_json(user)
          { id: user.id, name: user.full_name, first_name: user.display_name, role: user.role,
            on_file_email: visible_email("on_file", ::PayDocuments.on_file_email(user)) }
        end

        def can_choose_recipient?
          ::PayDocuments.can_choose_recipient?(current_user)
        end

        # Typed addresses stay visible to every sender, so a request to an
        # unfamiliar inbox can be spotted.
        def visible_email(kind, address)
          return address if address.nil? || kind == "typed" || can_choose_recipient?

          ::PayDocuments.masked_email(address)
        end

        def delivery_json(delivery)
          {
            id: delivery.id,
            state: delivery.state,
            origin: delivery.origin,
            worker: { id: delivery.user_id, name: delivery.user.full_name },
            sent_by: delivery.sent_by.full_name,
            recipient_email: visible_email(delivery.recipient_kind, delivery.recipient_email),
            recipient_kind: delivery.recipient_kind,
            request_id: delivery.pay_document_request_id,
            sent_at: delivery.created_at.iso8601,
            expires_at: delivery.expires_at.iso8601,
            revoked_at: delivery.revoked_at&.iso8601,
            revoked_by: delivery.revoked_by&.full_name,
            max_downloads_per_document: delivery.max_downloads_per_document,
            documents: delivery.pay_document_items.map do |item|
              { id: item.id, pay_date: item.document_date&.iso8601, period_start: item.period_start&.iso8601,
                period_end: item.period_end&.iso8601, downloads_used: item.download_count }
            end
          }
        end
      end
    end
  end
end
