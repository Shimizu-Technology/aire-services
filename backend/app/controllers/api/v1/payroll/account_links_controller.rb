# frozen_string_literal: true

module Api
  module V1
    module Payroll
      class AccountLinksController < ApplicationController
        include SharedSecretAuthenticatable

        before_action :authenticate_shared_secret!

        def show
          link = find_link
          render json: { account_link: serialize_link(link) }
        end

        def destroy
          link = find_link
          if link&.active?
            PayrollAccountLink.transaction do
              link.revoke!
              AuditLog.record!(
                action: "payroll_account_link.disconnected",
                actor: nil,
                actor_kind: "integration",
                source: "integration",
                auditable: link,
                event_category: "security",
                metadata: { external_system: link.external_system, external_actor_id: link.external_actor_id }
              )
            end
          end
          render json: { account_link: serialize_link(link) }
        rescue ActiveRecord::RecordInvalid => e
          render json: { error: e.record.errors.full_messages.join(", ") }, status: :unprocessable_entity
        end

        private

        def find_link
          PayrollAccountLink.includes(:user).find_by(
            external_system: PayrollAccountLink::EXTERNAL_SYSTEM,
            external_actor_id: params[:external_actor_id].to_s
          )
        end

        def serialize_link(link)
          return { connected: false } unless link&.connected?

          {
            connected: true,
            aire_user_name: link.user.full_name,
            aire_user_email: link.user.email,
            linked_at: link.linked_at.iso8601
          }
        end
      end
    end
  end
end
