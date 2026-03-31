# frozen_string_literal: true

module Api
  module V1
    module Admin
      class PayrollImportBatchesController < BaseController
        before_action :authenticate_user!
        before_action :require_admin!
        before_action :set_batch, only: [:show]

        # GET /api/v1/admin/payroll_import_batches
        def index
          batches = PayrollImportBatch.recent_first
          batches = batches.by_status(params[:status]) if params[:status].present?

          render json: {
            payroll_import_batches: batches.map { |b| serialize(b) }
          }
        end

        # GET /api/v1/admin/payroll_import_batches/:id
        def show
          render json: {
            payroll_import_batch: serialize(@batch, include_payload: true)
          }
        end

        private

        def set_batch
          @batch = PayrollImportBatch.find(params[:id])
        end

        def serialize(batch, include_payload: false)
          data = {
            id: batch.id,
            idempotency_key: batch.idempotency_key,
            source_payroll_run_id: batch.source_payroll_run_id,
            status: batch.status,
            total_gross: batch.total_gross&.to_f,
            total_net: batch.total_net&.to_f,
            total_tax: batch.total_tax&.to_f,
            employee_count: batch.employee_count,
            error_message: batch.error_message,
            reconciliation_details: batch.reconciliation_details,
            created_at: batch.created_at,
            updated_at: batch.updated_at
          }

          data[:payload] = batch.payload if include_payload

          data
        end
      end
    end
  end
end
