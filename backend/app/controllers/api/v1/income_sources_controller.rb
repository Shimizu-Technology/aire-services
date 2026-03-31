# frozen_string_literal: true

module Api
  module V1
    class IncomeSourcesController < BaseController
      before_action :authenticate_user!
      before_action :require_staff!
      before_action :set_tax_return
      before_action :set_income_source, only: [:show, :update, :destroy]

      # GET /api/v1/tax_returns/:tax_return_id/income_sources
      def index
        render json: {
          income_sources: @tax_return.income_sources.map { |src| serialize_income_source(src) }
        }
      end

      # GET /api/v1/tax_returns/:tax_return_id/income_sources/:id
      def show
        render json: { income_source: serialize_income_source(@income_source) }
      end

      # POST /api/v1/tax_returns/:tax_return_id/income_sources
      def create
        @income_source = @tax_return.income_sources.build(income_source_params)

        if @income_source.save
          # Log to workflow_events (shows on tax return detail and activity page)
          @tax_return.workflow_events.create!(
            event_type: "income_source_added",
            new_value: "#{@income_source.source_type.upcase}: #{@income_source.payer_name}",
            description: "Added income source: #{@income_source.source_type.upcase} - #{@income_source.payer_name}",
            user: current_user
          )

          render json: { income_source: serialize_income_source(@income_source) }, status: :created
        else
          render json: { errors: @income_source.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # PATCH /api/v1/tax_returns/:tax_return_id/income_sources/:id
      def update
        old_payer = @income_source.payer_name
        old_type = @income_source.source_type

        if @income_source.update(income_source_params)
          # Log if changed
          if old_payer != @income_source.payer_name || old_type != @income_source.source_type
            old_value = "#{old_type.upcase}: #{old_payer}"
            new_value = "#{@income_source.source_type.upcase}: #{@income_source.payer_name}"

            # Log to workflow_events (shows on tax return detail and activity page)
            @tax_return.workflow_events.create!(
              event_type: "income_source_updated",
              old_value: old_value,
              new_value: new_value,
              description: "Updated income source from #{old_value} to #{new_value}",
              user: current_user
            )
          end

          render json: { income_source: serialize_income_source(@income_source) }
        else
          render json: { errors: @income_source.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # DELETE /api/v1/tax_returns/:tax_return_id/income_sources/:id
      def destroy
        payer_name = @income_source.payer_name
        source_type = @income_source.source_type
        old_value = "#{source_type.upcase}: #{payer_name}"

        if @income_source.destroy
          # Log to workflow_events (shows on tax return detail and activity page)
          @tax_return.workflow_events.create!(
            event_type: "income_source_removed",
            old_value: old_value,
            description: "Removed income source: #{old_value}",
            user: current_user
          )

          head :no_content
        else
          render json: { errors: @income_source.errors.full_messages }, status: :unprocessable_entity
        end
      end

      private

      def set_tax_return
        @tax_return = TaxReturn.find(params[:tax_return_id])
      rescue ActiveRecord::RecordNotFound
        render json: { error: "Tax return not found" }, status: :not_found
      end

      def set_income_source
        @income_source = @tax_return.income_sources.find(params[:id])
      rescue ActiveRecord::RecordNotFound
        render json: { error: "Income source not found" }, status: :not_found
      end

      def income_source_params
        params.require(:income_source).permit(:source_type, :payer_name, :notes)
      end

      def serialize_income_source(src)
        {
          id: src.id,
          source_type: src.source_type,
          payer_name: src.payer_name,
          notes: src.notes,
          created_at: src.created_at,
          updated_at: src.updated_at
        }
      end
    end
  end
end
