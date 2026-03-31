# frozen_string_literal: true

module Api
  module V1
    class TaxReturnsController < BaseController
      # Require authentication and staff role for all actions
      before_action :authenticate_user!
      before_action :require_staff!

      # GET /api/v1/tax_returns
      def index
        returns = TaxReturn.includes(:client, :workflow_stage, :assigned_to)
                           .order(created_at: :desc)

        # Filter by stage
        if params[:stage].present?
          returns = returns.joins(:workflow_stage)
                           .where(workflow_stages: { slug: params[:stage] })
        end

        # Filter by year
        if params[:year].present?
          returns = returns.where(tax_year: params[:year])
        end

        # Filter by assigned user
        if params[:assigned_to].present?
          returns = returns.where(assigned_to_id: params[:assigned_to])
        end

        # Search by client name
        if params[:search].present?
          search_term = "%#{params[:search].downcase}%"
          returns = returns.joins(:client).where(
            "LOWER(clients.first_name) LIKE ? OR LOWER(clients.last_name) LIKE ?",
            search_term, search_term
          )
        end

        # Pagination
        page = (params[:page] || 1).to_i
        per_page = (params[:per_page] || 20).to_i.clamp(1, 100)
        total_count = returns.count
        returns = returns.offset((page - 1) * per_page).limit(per_page)

        render json: {
          tax_returns: returns.map { |tr| tax_return_summary(tr) },
          meta: {
            current_page: page,
            per_page: per_page,
            total_count: total_count,
            total_pages: (total_count.to_f / per_page).ceil
          }
        }
      end

      # GET /api/v1/tax_returns/:id
      def show
        tax_return = TaxReturn.includes(
          :client, :workflow_stage, :assigned_to, :reviewed_by,
          :income_sources, :documents, :workflow_events
        ).find(params[:id])

        render json: { tax_return: tax_return_detail(tax_return) }
      end

      # PATCH /api/v1/tax_returns/:id
      def update
        tax_return = TaxReturn.find(params[:id])
        tax_return.current_actor = current_user  # For audit logging

        if tax_return.update(tax_return_params)
          render json: { tax_return: tax_return_summary(tax_return.reload) }
        else
          render json: { errors: tax_return.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # POST /api/v1/tax_returns/:id/assign
      def assign
        tax_return = TaxReturn.find(params[:id])
        user = User.find(params[:user_id])
        tax_return.current_actor = current_user  # For audit logging

        tax_return.update!(assigned_to: user)

        render json: {
          message: "Tax return assigned to #{user.full_name}",
          tax_return: tax_return_summary(tax_return)
        }
      rescue ActiveRecord::RecordNotFound => e
        render json: { error: e.message }, status: :not_found
      end

      private

      def tax_return_params
        params.require(:tax_return).permit(
          :workflow_stage_id, :assigned_to_id, :reviewed_by_id, :notes
        )
      end

      def tax_return_summary(tr)
        {
          id: tr.id,
          tax_year: tr.tax_year,
          client: {
            id: tr.client.id,
            full_name: tr.client.full_name,
            email: tr.client.email
          },
          status: tr.workflow_stage&.name,
          status_slug: tr.workflow_stage&.slug,
          status_color: tr.workflow_stage&.color,
          assigned_to: tr.assigned_to ? {
            id: tr.assigned_to.id,
            name: tr.assigned_to.full_name
          } : nil,
          created_at: tr.created_at,
          updated_at: tr.updated_at
        }
      end

      def tax_return_detail(tr)
        {
          id: tr.id,
          tax_year: tr.tax_year,
          notes: tr.notes,
          completed_at: tr.completed_at,
          created_at: tr.created_at,
          updated_at: tr.updated_at,
          client: {
            id: tr.client.id,
            full_name: tr.client.full_name,
            email: tr.client.email,
            phone: tr.client.phone,
            filing_status: tr.client.filing_status
          },
          workflow_stage: tr.workflow_stage ? {
            id: tr.workflow_stage.id,
            name: tr.workflow_stage.name,
            slug: tr.workflow_stage.slug,
            color: tr.workflow_stage.color
          } : nil,
          assigned_to: tr.assigned_to ? {
            id: tr.assigned_to.id,
            name: tr.assigned_to.full_name,
            email: tr.assigned_to.email
          } : nil,
          reviewed_by: tr.reviewed_by ? {
            id: tr.reviewed_by.id,
            name: tr.reviewed_by.full_name
          } : nil,
          income_sources: tr.income_sources.map do |src|
            { id: src.id, source_type: src.source_type, payer_name: src.payer_name }
          end,
          documents: tr.documents.includes(:uploaded_by).order(created_at: :desc).map do |doc|
            {
              id: doc.id,
              filename: doc.filename,
              document_type: doc.document_type,
              content_type: doc.content_type,
              file_size: doc.file_size,
              uploaded_by: doc.uploaded_by ? {
                id: doc.uploaded_by.id,
                email: doc.uploaded_by.email
              } : nil,
              created_at: doc.created_at,
              tax_return_id: doc.tax_return_id
            }
          end,
          workflow_events: tr.workflow_events.recent.map do |event|
            {
              id: event.id,
              event_type: event.event_type,
              old_value: event.old_value,
              new_value: event.new_value,
              description: event.description,
              actor: event.actor_name,
              created_at: event.created_at
            }
          end
        }
      end
    end
  end
end
