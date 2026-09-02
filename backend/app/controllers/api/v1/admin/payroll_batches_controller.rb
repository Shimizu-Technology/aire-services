# frozen_string_literal: true

module Api
  module V1
    module Admin
      class PayrollBatchesController < BaseController
        before_action :require_admin!
        before_action :find_batch, only: %i[show export]

        def index
          total_count = PayrollBatch.count
          batches = PayrollBatch.includes(:finalized_by).order(finalized_at: :desc).limit(100).to_a
          render json: {
            payroll_batches: batches.map { |batch| serialize_summary(batch) },
            total_count: total_count,
            truncated: total_count > batches.length
          }
        end

        def show
          render json: serialize_detail(@payroll_batch)
        end

        def preview
          result = ::Payroll::BatchBuilder.new(
            start_date: params[:start_date],
            end_date: params[:end_date]
          ).call
          render json: result.fetch(:payload).merge(
            preview: true,
            can_finalize: result.dig(:issues, :missing_category_count).zero?,
            requires_negative_adjustment_acknowledgement: result.dig(:issues, :negative_adjustment_count).positive?
          )
        rescue ArgumentError => e
          render json: { error: e.message }, status: :unprocessable_entity
        end

        def carryovers
          render json: ::Payroll::CarryoverQueue.new.call
        end

        def create
          batch = ::Payroll::BatchFinalizer.new(
            start_date: params[:start_date],
            end_date: params[:end_date],
            actor: current_user,
            acknowledge_negative_adjustments: params[:acknowledge_negative_adjustments],
            negative_adjustment_note: params[:negative_adjustment_note]
          ).call
          Current.domain_audit_recorded = true
          render json: serialize_detail(batch), status: :created
        rescue ArgumentError, ::Payroll::BatchFinalizer::FinalizationError => e
          render json: { error: e.message }, status: :unprocessable_entity
        end

        def export
          csv = Reports::PayrollBatchCsv.render(@payroll_batch)
          AuditLog.record!(
            action: "payroll_batch.exported",
            actor: current_user,
            auditable: @payroll_batch,
            event_category: "payroll",
            metadata: { format: "csv", checksum: @payroll_batch.checksum }
          )
          send_data csv,
                    filename: "#{@payroll_batch.public_id}.csv",
                    type: "text/csv; charset=utf-8",
                    disposition: "attachment"
        end

        private

        def find_batch
          @payroll_batch = PayrollBatch.find_by!(public_id: params[:id])
        end

        def serialize_summary(batch)
          {
            id: batch.public_id,
            start_date: batch.start_date.iso8601,
            end_date: batch.end_date.iso8601,
            cutoff_at: batch.cutoff_at.iso8601,
            finalized_at: batch.finalized_at.iso8601,
            finalized_by: batch.finalized_by && { id: batch.finalized_by.id, name: batch.finalized_by.full_name },
            checksum: batch.checksum,
            processing: batch.processing_status,
            summary: batch.summary,
            issues: batch.issues
          }
        end

        def serialize_detail(batch)
          serialize_summary(batch).merge(payload: batch.export_payload)
        end
      end
    end
  end
end
