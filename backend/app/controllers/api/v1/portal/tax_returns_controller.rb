# frozen_string_literal: true

module Api
  module V1
    module Portal
      class TaxReturnsController < BaseController
        before_action :set_tax_return, only: [:show]

        # GET /api/v1/portal/tax_returns
        def index
          tax_returns = current_client.tax_returns
                                      .includes(:workflow_stage, :assigned_to, :income_sources, :documents)
                                      .order(tax_year: :desc)

          render json: {
            tax_returns: tax_returns.map { |tr| serialize_tax_return(tr) }
          }
        end

        # GET /api/v1/portal/tax_returns/:id
        def show
          render json: {
            tax_return: serialize_tax_return_detail(@tax_return)
          }
        end

        private

        def set_tax_return
          @tax_return = current_client.tax_returns
                                      .includes(:workflow_stage, :assigned_to, :income_sources, :documents)
                                      .find(params[:id])
        end

        def serialize_tax_return(tr)
          {
            id: tr.id,
            tax_year: tr.tax_year,
            status: tr.workflow_stage&.name || "Unknown",
            status_slug: tr.workflow_stage&.slug || "unknown",
            status_color: tr.workflow_stage&.color,
            assigned_to: tr.assigned_to&.full_name,
            income_sources: tr.income_sources.map { |is| { id: is.id, source_type: is.source_type, payer_name: is.payer_name } },
            documents_count: tr.documents.size,
            created_at: tr.created_at,
            updated_at: tr.updated_at
          }
        end

        def serialize_tax_return_detail(tr)
          all_stages = @all_workflow_stages ||= WorkflowStage.active.ordered.to_a
          current_position = tr.workflow_stage&.position || 0

          {
            id: tr.id,
            tax_year: tr.tax_year,
            status: tr.workflow_stage&.name || "Unknown",
            status_slug: tr.workflow_stage&.slug || "unknown",
            status_color: tr.workflow_stage&.color,
            assigned_to: tr.assigned_to&.full_name,
            income_sources: tr.income_sources.map { |is|
              { id: is.id, source_type: is.source_type, payer_name: is.payer_name }
            },
            documents: tr.documents.sort_by(&:created_at).reverse.map { |doc|
              {
                id: doc.id,
                filename: doc.filename,
                document_type: doc.document_type,
                content_type: doc.content_type,
                file_size: doc.file_size,
                created_at: doc.created_at
              }
            },
            workflow_progress: {
              current_stage: tr.workflow_stage&.name || "Unknown",
              current_position: current_position,
              stages: all_stages.map { |s|
                {
                  name: s.name,
                  slug: s.slug,
                  position: s.position,
                  color: s.color,
                  completed: s.position < current_position,
                  current: s.id == tr.workflow_stage_id
                }
              }
            },
            created_at: tr.created_at,
            updated_at: tr.updated_at
          }
        end
      end
    end
  end
end
