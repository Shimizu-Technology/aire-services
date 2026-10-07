# frozen_string_literal: true

module Api
  module V1
    module Payroll
      module Cockpit
        class ManualAllocationsController < BaseController
          PAYROLL_COMMAND_CAPABILITY = "settlement_case_management"

          before_action :authenticate_payroll_actor!, only: %i[index create issue void cancel_payment]

          def index
            period_id = params[:external_pay_period_id].to_s.strip
            return render json: { error: "Cornerstone pay period is required" }, status: :unprocessable_entity if period_id.blank?

            scope = PayrollManualAllocation.where(external_pay_period_id: period_id)
              .includes(:user, :payroll_manual_allocation_events)
              .order(:id)
            page = pagination_for(scope, maximum: 250)
            render json: {
              manual_allocations: page.fetch(:records).map { |allocation| serialize(allocation) },
              pagination: page.fetch(:metadata)
            }
          end

          def create
            entry = TimeEntry.joins(:user).merge(User.staff).find(params.fetch(:source_time_entry_id))
            permitted = allocation_params
            run_command(
              action: "payroll_manual_allocation.commit",
              target: entry,
              payload: permitted.to_h,
              status: :created,
              replay: ->(_entry, metadata) { replay_result(metadata) },
              response: ->(_entry, body) { body }
            ) do |locked_entry, reason|
              allocation = recorder.commit!(
                entry: locked_entry,
                source_user_uuid: permitted.fetch(:source_user_uuid),
                regular_hours: permitted.fetch(:regular_hours),
                overtime_hours: permitted.fetch(:overtime_hours),
                external_pay_period_id: permitted.fetch(:external_pay_period_id),
                external_payroll_item_id: permitted.fetch(:external_payroll_item_id),
                pay_date: permitted.fetch(:pay_date),
                reason: reason
              )
              [ { manual_allocation: serialize(allocation) },
                { manual_allocation_id: allocation.id, result_version: allocation.lock_version, status: allocation.status } ]
            end
          rescue ::Payroll::ManualAllocationRecorder::Error, ActiveRecord::RecordInvalid => e
            audit_invalid_command(entry, e) if entry
            render json: { error: e.message }, status: :unprocessable_entity
          rescue ActiveRecord::RecordNotUnique
            render json: { error: "These source hours were already linked; refresh the reconciliation" }, status: :conflict
          end

          def issue
            transition!("issue")
          end

          def cancel_payment
            transition!("cancel_payment")
          end

          def void
            transition!("void")
          end

          private

          def allocation_params
            params.permit(:command_id, :expected_version, :reason, :source_user_uuid,
                          :regular_hours, :overtime_hours, :external_pay_period_id,
                          :external_payroll_item_id, :pay_date)
          end

          def transition_params
            params.permit(:command_id, :expected_version, :reason, :occurred_at,
                          :payment_method, :payment_reference, :payment_effective_on, :cancellation_evidence_reference)
          end

          def transition!(action)
            allocation = PayrollManualAllocation.find(params[:id])
            permitted = transition_params
            run_command(
              action: "payroll_manual_allocation.#{action}",
              target: allocation,
              payload: permitted.to_h,
              replay: ->(_current, metadata) { replay_result(metadata) },
              response: ->(current, body) { action == "cancel_payment" ? body : { manual_allocation: serialize(current) } }
            ) do |locked_allocation, reason|
              if action == "issue"
                recorder.issue!(
                  allocation: locked_allocation,
                  payment_method: permitted.fetch(:payment_method),
                  payment_reference: permitted.fetch(:payment_reference),
                  payment_effective_on: permitted.fetch(:payment_effective_on),
                  occurred_at: permitted.fetch(:occurred_at),
                  reason: reason
                )
              elsif action == "cancel_payment"
                recorder.cancel_payment!(
                  allocation: locked_allocation,
                  payment_method: permitted.fetch(:payment_method),
                  payment_reference: permitted.fetch(:payment_reference),
                  payment_effective_on: permitted[:payment_effective_on],
                  occurred_at: permitted.fetch(:occurred_at), reason: reason,
                  cancellation_evidence_reference: permitted.fetch(:cancellation_evidence_reference)
                )
              else
                recorder.void!(allocation: locked_allocation,
                               occurred_at: permitted.fetch(:occurred_at), reason: reason)
              end
              metadata = { manual_allocation_id: locked_allocation.id, result_version: locked_allocation.lock_version, status: locked_allocation.status }
              if action == "cancel_payment"
                event = locked_allocation.payroll_manual_allocation_events.order(:id).last
                snapshot = serialize(locked_allocation).slice(:id, :version, :source_time_entry_id,
                  :source_time_entry_version, :source_user_uuid, :work_date, :regular_hours, :overtime_hours,
                  :external_pay_period_id, :external_payroll_item_id, :status).merge(
                  total_hours: locked_allocation.total_hours.to_f, cancelled_payment: {
                  event_id: event.id.to_s, event_type: event.event_type, occurred_at: event.occurred_at.iso8601(6),
                  payment_method: event.payment_method, payment_reference: event.payment_reference,
                  payment_effective_on: event.payment_effective_on&.iso8601,
                  cancellation_evidence_reference: event.cancellation_evidence_reference
                }).deep_stringify_keys
                metadata[:manual_allocation] = snapshot
                [ replay_result(metadata.deep_stringify_keys), metadata ]
              else
                [ {}, metadata ]
              end
            end
          rescue ::Payroll::ManualAllocationRecorder::Error, ActiveRecord::RecordInvalid => e
            audit_invalid_command(allocation, e) if allocation
            render json: { error: e.message }, status: :unprocessable_entity
          end

          def recorder
            @recorder ||= ::Payroll::ManualAllocationRecorder.new(actor: payroll_actor)
          end

          def replay_result(metadata)
            snapshot = metadata["manual_allocation"]&.deep_dup
            if snapshot
              proof = snapshot.fetch("cancelled_payment")
              event = PayrollManualAllocationEvent.find_by!(id: proof.fetch("event_id"),
                payroll_manual_allocation_id: metadata.fetch("manual_allocation_id"), event_type: "payment_cancelled")
              # Free text already lives in the append-only event; keep the
              # bounded command receipt free of duplicated personal content.
              proof["reason"] = event.reason
            end
            { command_result: metadata,
              manual_allocation: snapshot || { id: metadata.fetch("manual_allocation_id").to_s,
                                   version: metadata.fetch("result_version"), status: metadata.fetch("status") } }
          end

          def serialize(allocation)
            {
              id: allocation.id.to_s,
              version: allocation.lock_version,
              source_time_entry_id: allocation.time_entry_id.to_s,
              source_user_uuid: allocation.source_user_uuid,
              employee_name: allocation.user.full_name,
              work_date: allocation.work_date.iso8601,
              pay_date: allocation.pay_date.iso8601,
              source_time_entry_version: allocation.source_time_entry_version,
              time_category_id: allocation.time_category_id&.to_s,
              regular_hours: allocation.regular_hours.to_f,
              overtime_hours: allocation.overtime_hours.to_f,
              external_pay_period_id: allocation.external_pay_period_id,
              external_payroll_item_id: allocation.external_payroll_item_id,
              status: allocation.status,
              payment_method: allocation.payment_method,
              payment_reference: allocation.payment_reference,
              payment_effective_on: allocation.payment_effective_on&.iso8601,
              issued_at: allocation.issued_at&.iso8601,
              voided_at: allocation.voided_at&.iso8601,
              payment_cancelled_at: allocation.payment_cancelled_at&.iso8601,
              events: allocation.payroll_manual_allocation_events.sort_by(&:id).map do |event|
                { event_type: event.event_type, occurred_at: event.occurred_at.iso8601,
                  payment_effective_on: event.payment_effective_on&.iso8601,
                  reason: event.reason, payment_method: event.payment_method, payment_reference: event.payment_reference,
                  cancellation_evidence_reference: event.cancellation_evidence_reference }.compact
              end
            }.compact
          end
        end
      end
    end
  end
end
