# frozen_string_literal: true

module Api
  module V1
    module Payroll
      class BatchesController < ApplicationController
        include SharedSecretAuthenticatable

        before_action :authenticate_shared_secret!
        rescue_from ActiveRecord::RecordNotFound, with: :batch_not_found

        def index
          scope = PayrollBatch.order(finalized_at: :desc)
          scope = scope.where(start_date: Date.iso8601(params[:start_date])) if params[:start_date].present?
          scope = scope.where(end_date: Date.iso8601(params[:end_date])) if params[:end_date].present?
          batches = scope.limit(100).to_a
          AuditLog.record!(
            action: "payroll_batch.listed",
            actor: nil,
            actor_kind: "integration",
            source: "integration",
            event_category: "integration",
            subject_type: "PayrollBatch",
            subject_id: 0,
            subject_name: "Finalized payroll batches",
            metadata: {
              start_date: params[:start_date].presence,
              end_date: params[:end_date].presence,
              result_count: batches.size
            }.compact
          )
          render json: {
            payroll_batches: batches.map do |batch|
              {
                id: batch.public_id,
                start_date: batch.start_date.iso8601,
                end_date: batch.end_date.iso8601,
                cutoff_at: batch.cutoff_at.iso8601,
                finalized_at: batch.finalized_at.iso8601,
                checksum: batch.checksum,
                summary: batch.summary
              }
            end
          }
        rescue Date::Error
          render json: { error: "Dates must use YYYY-MM-DD" }, status: :unprocessable_entity
        end

        def show
          batch = PayrollBatch.find_by!(public_id: params[:id])
          AuditLog.record!(
            action: "payroll_batch.retrieved",
            actor: nil,
            actor_kind: "integration",
            source: "integration",
            event_category: "integration",
            auditable: batch,
            metadata: { checksum: batch.checksum }
          )
          render json: batch.export_payload
        end

        def processing_events
          batch = PayrollBatch.find_by!(public_id: params[:id])
          permitted = params.permit(
            :event_id,
            :status,
            :occurred_at,
            :external_system,
            :external_pay_period_id,
            :external_payroll_item_id,
            :source_time_entry_id,
            :source_user_uuid,
            :payment_method,
            :payment_reference,
            metadata: {}
          )
          occurred_at = begin
            Time.iso8601(permitted.fetch(:occurred_at))
          rescue ArgumentError, TypeError => e
            return render json: { error: e.message }, status: :unprocessable_entity
          end
          metadata = permitted[:metadata]&.to_h || {}

          if permitted[:source_time_entry_id].present?
            return record_entry_processing_event(batch, permitted, occurred_at: occurred_at, metadata: metadata)
          end

          event = PayrollBatchProcessingEvent.find_by(event_id: permitted.fetch(:event_id))
          created = false
          unless event
            begin
              PayrollBatchProcessingEvent.transaction do
                event = PayrollBatchProcessingEvent.create!(
                  event_id: permitted.fetch(:event_id),
                  payroll_batch: batch,
                  status: permitted.fetch(:status),
                  occurred_at: occurred_at,
                  external_system: permitted.fetch(:external_system),
                  external_pay_period_id: permitted[:external_pay_period_id],
                  metadata: metadata
                )
                AuditLog.record!(
                  action: "payroll_batch.processing_status_recorded",
                  actor: nil,
                  actor_kind: "integration",
                  source: "integration",
                  event_category: "payroll",
                  auditable: batch,
                  metadata: {
                    event_id: event.event_id,
                    status: event.status,
                    occurred_at: event.occurred_at.iso8601,
                    external_system: event.external_system,
                    external_pay_period_id: event.external_pay_period_id
                  }.compact
                )
              end
              created = true
            rescue ActiveRecord::RecordNotUnique
              event = PayrollBatchProcessingEvent.find_by!(event_id: permitted.fetch(:event_id))
            end
          end

          unless same_processing_event?(event, batch, permitted, occurred_at: occurred_at, metadata: metadata)
            return render json: { error: "Event ID already belongs to a different processing event" }, status: :conflict
          end

          render json: { processing: batch.reload.processing_status }, status: created ? :created : :ok
        rescue ActionController::ParameterMissing, ArgumentError => e
          render json: { error: e.message }, status: :unprocessable_entity
        rescue ActiveRecord::RecordInvalid => e
          render json: { error: e.record.errors.full_messages.join(", ") }, status: :unprocessable_entity
        end

        private

        def record_entry_processing_event(batch, permitted, occurred_at:, metadata:)
          source_time_entry_id = Integer(permitted.fetch(:source_time_entry_id), 10)
          batch_entry = batch.payroll_batch_entries.find_by!(source_time_entry_id: source_time_entry_id)
          source_user_uuid = permitted[:source_user_uuid].to_s.strip.downcase.presence
          if source_user_uuid.present? && batch_entry.source_user_uuid.present? &&
             source_user_uuid != batch_entry.source_user_uuid.to_s
            return render json: { error: "Source staff identity does not match this payroll entry" }, status: :conflict
          end

          event = PayrollEntryProcessingEvent.find_by(event_id: permitted.fetch(:event_id))
          created = false
          unless event
            begin
              PayrollEntryProcessingEvent.transaction do
                event = PayrollEntryProcessingEvent.create!(
                  event_id: permitted.fetch(:event_id),
                  payroll_batch: batch,
                  source_time_entry_id: source_time_entry_id,
                  source_user_uuid: source_user_uuid,
                  status: permitted.fetch(:status),
                  occurred_at: occurred_at,
                  external_system: permitted.fetch(:external_system),
                  external_pay_period_id: permitted[:external_pay_period_id],
                  external_payroll_item_id: permitted[:external_payroll_item_id],
                  payment_method: permitted[:payment_method],
                  payment_reference: permitted[:payment_reference],
                  metadata: metadata
                )
                AuditLog.record!(
                  action: "payroll_entry.processing_status_recorded",
                  actor: nil,
                  actor_kind: "integration",
                  source: "integration",
                  event_category: "payroll",
                  auditable: batch,
                  metadata: {
                    event_id: event.event_id,
                    source_time_entry_id: event.source_time_entry_id,
                    source_user_uuid: event.source_user_uuid,
                    status: event.status,
                    occurred_at: event.occurred_at.iso8601,
                    external_system: event.external_system,
                    external_pay_period_id: event.external_pay_period_id,
                    external_payroll_item_id: event.external_payroll_item_id,
                    payment_method: event.payment_method,
                    payment_reference: event.payment_reference
                  }.compact
                )
              end
              created = true
            rescue ActiveRecord::RecordNotUnique
              event = PayrollEntryProcessingEvent.find_by!(event_id: permitted.fetch(:event_id))
            end
          end

          unless same_entry_processing_event?(
            event,
            batch,
            permitted,
            occurred_at: occurred_at,
            metadata: metadata,
            source_time_entry_id: source_time_entry_id,
            source_user_uuid: source_user_uuid
          )
            return render json: { error: "Event ID already belongs to a different processing event" }, status: :conflict
          end

          render json: { entry_processing: serialize_entry_processing_event(event) }, status: created ? :created : :ok
        rescue ArgumentError
          render json: { error: "source_time_entry_id must be an integer" }, status: :unprocessable_entity
        rescue ActiveRecord::RecordNotFound
          render json: { error: "Payroll batch entry not found" }, status: :not_found
        end

        def same_processing_event?(event, batch, permitted, occurred_at:, metadata:)
          event.payroll_batch_id == batch.id &&
            event.status == permitted[:status] &&
            event.external_system == permitted[:external_system] &&
            event.external_pay_period_id.to_s == permitted[:external_pay_period_id].to_s &&
            normalized_processing_time(event.occurred_at) == normalized_processing_time(occurred_at) &&
            event.metadata == metadata
        end

        def same_entry_processing_event?(event, batch, permitted, occurred_at:, metadata:, source_time_entry_id:, source_user_uuid:)
          event.payroll_batch_id == batch.id &&
            event.source_time_entry_id == source_time_entry_id &&
            event.source_user_uuid.to_s == source_user_uuid.to_s &&
            event.status == permitted[:status] &&
            event.external_system == permitted[:external_system] &&
            event.external_pay_period_id.to_s == permitted[:external_pay_period_id].to_s &&
            event.external_payroll_item_id.to_s == permitted[:external_payroll_item_id].to_s &&
            event.payment_method.to_s == permitted[:payment_method].to_s &&
            event.payment_reference.to_s == permitted[:payment_reference].to_s &&
            normalized_entry_processing_time(event.occurred_at) == normalized_entry_processing_time(occurred_at) &&
            event.metadata == metadata
        end

        def serialize_entry_processing_event(event)
          {
            event_id: event.event_id,
            source_time_entry_id: event.source_time_entry_id.to_s,
            source_user_uuid: event.source_user_uuid,
            status: event.status,
            occurred_at: event.occurred_at.iso8601,
            external_system: event.external_system,
            external_pay_period_id: event.external_pay_period_id,
            external_payroll_item_id: event.external_payroll_item_id,
            payment_method: event.payment_method,
            payment_reference: event.payment_reference
          }.compact
        end

        def normalized_processing_time(value)
          precision = PayrollBatchProcessingEvent.columns_hash.fetch("occurred_at").precision || 6
          value.to_time.utc.floor(precision)
        end

        def normalized_entry_processing_time(value)
          precision = PayrollEntryProcessingEvent.columns_hash.fetch("occurred_at").precision || 6
          value.to_time.utc.floor(precision)
        end

        def batch_not_found
          render json: { error: "Payroll batch not found" }, status: :not_found
        end
      end
    end
  end
end
