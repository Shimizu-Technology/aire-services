# frozen_string_literal: true

require "cgi"
require "uri"

module Api
  module V1
    module Payroll
      class AccountLinkSessionsController < Api::V1::BaseController
        include SharedSecretAuthenticatable

        before_action :authenticate_shared_secret!, only: :create
        before_action :authenticate_user!, only: %i[show authorize]
        before_action :require_admin!, only: %i[show authorize]

        def create
          session = PayrollAccountLinkSession.issue!(
            external_actor_id: link_params.fetch(:external_actor_id),
            external_actor_email: link_params[:external_actor_email],
            return_url: link_params.fetch(:return_url)
          )

          render json: {
            authorization_url: authorization_url(session.issued_token),
            expires_at: session.expires_at.iso8601
          }, status: :created
        end

        def show
          session = available_session!
          render json: {
            account_link_session: {
              external_actor_email: session.external_actor_email,
              expires_at: session.expires_at.iso8601,
              return_url: session.return_url,
              aire_user: {
                name: current_user.full_name,
                email: current_user.email
              }
            }
          }
        end

        def authorize
          session = available_session!
          link = PayrollAccountLink.transaction do
            authorized_link = session.authorize!(current_user)
            AuditLog.record!(
              action: "payroll_account_link.connected",
              actor: current_user,
              auditable: authorized_link,
              event_category: "security",
              metadata: {
                external_system: authorized_link.external_system,
                external_actor_id: authorized_link.external_actor_id
              }
            )
            authorized_link
          end

          render json: {
            account_link: serialize_link(link),
            redirect_url: callback_url(session.return_url, "connected")
          }
        rescue ActiveRecord::RecordInvalid => e
          render json: { error: e.record.errors.full_messages.join(", ") }, status: :unprocessable_entity
        end

        private

        def link_params
          params.permit(:external_actor_id, :external_actor_email, :return_url)
        end

        def available_session!
          PayrollAccountLinkSession.available_for_token(params[:token]) ||
            raise(ActiveRecord::RecordNotFound, "Connection request not found or expired")
        end

        def authorization_url(token)
          base_url = ENV.fetch("FRONTEND_URL", "http://localhost:5173").to_s.chomp("/")
          "#{base_url}/admin/payroll-link?token=#{CGI.escape(token)}"
        end

        def callback_url(raw_url, result)
          uri = URI.parse(raw_url)
          query = URI.decode_www_form(uri.query.to_s)
          query.reject! { |key, _value| key == "aire_link" }
          query << [ "aire_link", result ]
          uri.query = URI.encode_www_form(query)
          uri.to_s
        end

        def serialize_link(link)
          {
            connected: link.connected?,
            aire_user_name: link.user.full_name,
            aire_user_email: link.user.email,
            linked_at: link.linked_at.iso8601
          }
        end
      end
    end
  end
end
