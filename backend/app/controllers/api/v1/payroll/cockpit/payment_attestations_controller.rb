# frozen_string_literal: true

module Api
  module V1
    module Payroll
      module Cockpit
        class PaymentAttestationsController < BaseController
          PAYROLL_COMMAND_CAPABILITY = "settlement_case_management"

          before_action :authenticate_payroll_actor!, only: %i[index create retract resolve]

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
              replay: ->(_entry, metadata) { replay_result(metadata) },
              response: ->(_entry, body) { body }
            ) do |locked_entry, reason|
              attestation = recorder.attest!(
                entry: locked_entry,
                source_user_uuid: permitted.fetch(:source_user_uuid),
                reason: reason
              )
              [ { payment_attestation: serialize(attestation) },
                { payment_attestation_id: attestation.id, result_version: attestation.lock_version, status: attestation.status } ]
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
              replay: ->(_current, metadata) { replay_result(metadata) },
              response: ->(current, _body) { { payment_attestation: serialize(current) } }
            ) do |locked_attestation, reason|
              recorder.retract!(attestation: locked_attestation, reason: reason)
              [ {}, { payment_attestation_id: locked_attestation.id, result_version: locked_attestation.lock_version, status: locked_attestation.status } ]
            end
          rescue ::Payroll::PaymentAttestationRecorder::Error, ActiveRecord::RecordInvalid => e
            audit_invalid_command(attestation, e) if attestation
            render json: { error: e.message }, status: :unprocessable_entity
          end

          def resolve
            attestation = PayrollPaymentAttestation.find(params[:id])
            permitted = params.permit(:command_id, :expected_version, :source_time_entry_id,
              :source_time_entry_version, :source_user_uuid, :work_date, :regular_hours, :overtime_hours,
              :external_pay_period_id, :external_payroll_item_id, :pay_date, :payment_method,
              :payment_reference, :payment_effective_on, :occurred_at, :payroll_payment_event_type,
              :payroll_payment_event_id, :expected_weekly_context_fingerprint, :reason)
            required = %w[source_time_entry_id source_time_entry_version source_user_uuid work_date regular_hours
              overtime_hours external_pay_period_id external_payroll_item_id pay_date payment_method
              payment_reference payment_effective_on occurred_at payroll_payment_event_type payroll_payment_event_id
              expected_weekly_context_fingerprint reason]
            required.each { |key| permitted.require(key) }
            run_command(action: "payroll_payment_attestation.resolve", target: attestation, payload: permitted.to_h,
              replay: ->(_current, metadata) { resolution_result(metadata) },
              response: ->(_current, body) { body }) do |locked_attestation, _reason|
              expected_version = locked_attestation.lock_version
              result = ::Payroll::PaymentAttestationResolution.new(actor: payroll_actor).resolve!(
                attestation: locked_attestation, **permitted.except(:command_id, :expected_version).to_h.symbolize_keys)
              allocation = result.fetch(:allocation)
              metadata = {
                payment_attestation_id: locked_attestation.id, expected_version: expected_version,
                result_version: locked_attestation.lock_version, status: locked_attestation.status,
                payment_attestation: resolution_snapshot(locked_attestation),
                manual_allocation_id: allocation.id,
                manual_allocation_expected_version: result.fetch(:expected_allocation_version),
                manual_allocation_result_version: allocation.lock_version,
                manual_allocation: issued_allocation_snapshot(allocation, result.fetch(:issued_event)),
                expected_weekly_context_fingerprint: permitted.fetch(:expected_weekly_context_fingerprint),
                payroll_payment_event_type: permitted.fetch(:payroll_payment_event_type),
                payroll_payment_event_id: permitted.fetch(:payroll_payment_event_id).to_s,
                integration: ::Payroll::IntegrationProfile.call
              }.deep_stringify_keys
              [ resolution_result(metadata), metadata ]
            end
          rescue ::Payroll::PaymentAttestationResolution::Error, ::Payroll::ManualAllocationRecorder::Error,
                 ActiveRecord::RecordInvalid, ActionController::ParameterMissing => e
            audit_invalid_command(attestation, e) if attestation
            render json: { error: e.message }, status: :unprocessable_entity
          rescue ActiveRecord::RecordNotUnique
            render json: { error: "These reported source hours already have an exact payment match; refresh the evidence" }, status: :conflict
          end

          private

          def recorder
            @recorder ||= ::Payroll::PaymentAttestationRecorder.new(actor: payroll_actor)
          end

          def replay_result(metadata)
            { command_result: metadata,
              payment_attestation: { id: metadata.fetch("payment_attestation_id").to_s,
                                     version: metadata.fetch("result_version"), status: metadata.fetch("status") } }
          end

          def resolution_result(metadata)
            { command_result: metadata, payment_attestation: metadata.fetch("payment_attestation").deep_dup,
              manual_allocation: metadata.fetch("manual_allocation").deep_dup,
              integration: metadata.fetch("integration").deep_dup }
          end

          def resolution_snapshot(attestation)
            { id: attestation.id.to_s, version: attestation.lock_version,
              source_time_entry_id: attestation.time_entry_id.to_s, source_user_uuid: attestation.source_user_uuid,
              source_time_entry_version: attestation.source_time_entry_version,
              work_date: attestation.work_date.iso8601, hours: attestation.hours.to_f, status: attestation.status,
              attested_at: attestation.attested_at.iso8601(6), resolved_at: attestation.resolved_at.iso8601(6),
              resolved_by_id: attestation.resolved_by_id.to_s,
              resolved_manual_allocation_id: attestation.resolved_manual_allocation_id.to_s,
              resolved_issued_event_id: attestation.resolved_issued_event_id.to_s,
              resolution_evidence: attestation.resolution_evidence }
          end

          def issued_allocation_snapshot(allocation, event)
            { id: allocation.id.to_s, version: allocation.lock_version,
              source_time_entry_id: allocation.time_entry_id.to_s, source_time_entry_version: allocation.source_time_entry_version,
              source_user_uuid: allocation.source_user_uuid, work_date: allocation.work_date.iso8601,
              pay_date: allocation.pay_date.iso8601, time_category_id: allocation.time_category_id&.to_s,
              regular_hours: allocation.regular_hours.to_f, overtime_hours: allocation.overtime_hours.to_f,
              total_hours: allocation.total_hours.to_f, external_pay_period_id: allocation.external_pay_period_id,
              external_payroll_item_id: allocation.external_payroll_item_id, status: allocation.status,
              payment_method: allocation.payment_method, payment_reference: allocation.payment_reference,
              payment_effective_on: allocation.payment_effective_on.iso8601, issued_at: event.occurred_at.iso8601(6),
              issued_payment: { event_id: event.id.to_s, event_type: event.event_type,
                occurred_at: event.occurred_at.iso8601(6), payment_method: event.payment_method,
                payment_reference: event.payment_reference, payment_effective_on: event.payment_effective_on.iso8601 } }
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
              attested_at: attestation.attested_at.iso8601(6),
              recorded_by: attestation.recorded_by.full_name,
              source_changed: attestation.source_changed?,
              retracted_at: attestation.retracted_at&.iso8601,
              retraction_reason: attestation.retraction_reason,
              resolved_at: attestation.resolved_at&.iso8601(6),
              resolved_by_id: attestation.resolved_by_id&.to_s,
              resolved_manual_allocation_id: attestation.resolved_manual_allocation_id&.to_s,
              resolved_issued_event_id: attestation.resolved_issued_event_id&.to_s,
              resolution_reason: attestation.resolution_reason,
              resolution_evidence: attestation.resolution_evidence,
              resolution_context: ::Payroll::PaymentAttestationResolutionContext.new(attestation: attestation).call,
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
