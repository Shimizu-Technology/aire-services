# frozen_string_literal: true

module Api
  module V1
    module Portal
      class DashboardController < BaseController
        # GET /api/v1/portal/dashboard
        def show
          client = current_client
          tax_returns = client.tax_returns
                              .includes(:workflow_stage, :assigned_to, :documents)
                              .order(tax_year: :desc)

          render json: {
            client: {
              id: client.id,
              first_name: client.first_name,
              full_name: client.full_name,
              email: client.email,
              phone: client.phone,
              notification_preference: client.notification_preference
            },
            tax_returns: tax_returns.map { |tr| portal_tax_return(tr) },
            action_items: build_action_items(tax_returns)
          }
        end

        private

        def portal_tax_return(tr)
          {
            id: tr.id,
            tax_year: tr.tax_year,
            status: tr.workflow_stage&.name || "Unknown",
            status_slug: tr.workflow_stage&.slug || "unknown",
            status_color: tr.workflow_stage&.color,
            assigned_to: tr.assigned_to&.full_name,
            documents_count: tr.documents.size,
            created_at: tr.created_at,
            updated_at: tr.updated_at
          }
        end

        def build_action_items(tax_returns)
          items = []
          tax_returns.each do |tr|
            slug = tr.workflow_stage&.slug
            if slug == WorkflowStage::SLUGS[:documents_pending]
              items << {
                type: "documents_needed",
                message: "We need additional documents for your #{tr.tax_year} tax return.",
                tax_return_id: tr.id,
                tax_year: tr.tax_year
              }
            elsif slug == WorkflowStage::SLUGS[:ready_to_sign]
              items << {
                type: "ready_to_sign",
                message: "Your #{tr.tax_year} tax return is ready for signing.",
                tax_return_id: tr.id,
                tax_year: tr.tax_year
              }
            elsif slug == WorkflowStage::SLUGS[:ready_for_pickup]
              items << {
                type: "ready_for_pickup",
                message: "Your #{tr.tax_year} tax return is ready for pickup.",
                tax_return_id: tr.id,
                tax_year: tr.tax_year
              }
            end
          end
          items
        end
      end
    end
  end
end
