# frozen_string_literal: true

module Api
  module V1
    module Payroll
      module Cockpit
        class PaymentAttestationsController < BaseController
          PAYROLL_COMMAND_CAPABILITY = "settlement_case_management"

          before_action :authenticate_payroll_actor!, only: %i[index create retract]

          def index
            scope = PayrollPaymentAttestation.includes(:user, :time_entry, :recorded_by, :payroll_payment_attestation_events)
              .order(:work_date, :id)
            scope = scope.where(status: params[:status]) if params[:status].present?
            scope = scope.where(source_user_uuid: params[:source_user_uuid]) if params[:source_user_uuid].present?
            page = pagination_for(scope, maximum: 250)
            render json: {
              payment_attestations: page.fetch(:records).map { |attestation| serialize(attestation) },
              pagination: page.fetch(:metadata)
            }
          end

          def create
            entry = TimeEntry.joins(:user).merge(User.staff).find(params.fetch(:source_time_entry_id))
            permitted = params.permit(:source_user_uuid, :command_id, :expected_version, :reason)
            run_command(
              action: "payroll_payment_attestation.attest",
              target: entry,
              payload: permitted.to_h,
              status: :created,
              replay: ->(_entry, metadata) { { payment_attestation: serialize(PayrollPaymentAttestation.find(metadata.fetch("payment_attestation_id"))) } },
              response: ->(_entry, body) { body }
            ) do |locked_entry, reason|
              attestation = recorder.attest!(
                entry: locked_entry,
                source_user_uuid: permitted.fetch(:source_user_uuid),
                reason: reason
              )
              [ { payment_attestation: serialize(attestation) }, { payment_attestation_id: attestation.id } ]
            end
          rescue ::Payroll::PaymentAttestationRecorder::Error, ActiveRecord::RecordInvalid => e
            audit_invalid_command(entry, e) if entry
            render json: { error: e.message }, status: :unprocessable_entity
          end

          def retract
            attestation = PayrollPaymentAttestation.find(params[:id])
            permitted = params.permit(:command_id, :expected_version, :reason)
            run_command(
              action: "payroll_payment_attestation.retract",
              target: attestation,
              payload: permitted.to_h,
              replay: ->(current, _metadata) { { payment_attestation: serialize(current) } },
              response: ->(current, _body) { { payment_attestation: serialize(current) } }
            ) do |locked_attestation, reason|
              recorder.retract!(attestation: locked_attestation, reason: reason)
              [ {}, { payment_attestation_id: locked_attestation.id, status: locked_attestation.status } ]
            end
          rescue ::Payroll::PaymentAttestationRecorder::Error, ActiveRecord::RecordInvalid => e
            audit_invalid_command(attestation, e) if attestation
            render json: { error: e.message }, status: :unprocessable_entity
          end

          private

          def recorder
            @recorder ||= ::Payroll::PaymentAttestationRecorder.new(actor: payroll_actor)
          end

          def serialize(attestation)
            {
              id: attestation.id.to_s,
              version: attestation.lock_version,
              source_time_entry_id: attestation.time_entry_id.to_s,
              source_user_uuid: attestation.source_user_uuid,
              source_time_entry_version: attestation.source_time_entry_version,
              employee_name: attestation.user.full_name,
              work_date: attestation.work_date.iso8601,
              hours: attestation.hours.to_f,
              status: attestation.status,
              reason: attestation.reason,
              attested_at: attestation.attested_at.iso8601,
              recorded_by: attestation.recorded_by.full_name,
              source_changed: attestation.source_changed?,
              retracted_at: attestation.retracted_at&.iso8601,
              retraction_reason: attestation.retraction_reason,
              events: attestation.payroll_payment_attestation_events.sort_by(&:id).map do |event|
                { event_type: event.event_type, occurred_at: event.occurred_at.iso8601, reason: event.reason }
              end
            }.compact
          end
        end
      end
    end
  end
end
