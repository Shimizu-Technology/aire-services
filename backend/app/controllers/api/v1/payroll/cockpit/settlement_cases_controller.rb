# frozen_string_literal: true

module Api
  module V1
    module Payroll
      module Cockpit
        class SettlementCasesController < BaseController
          PAYROLL_COMMAND_CAPABILITY = "settlement_case_management"

          before_action :authenticate_payroll_actor!, only: %i[route_case acknowledge]
          before_action :set_settlement_case, only: %i[route_case acknowledge]

          def index
            scope = PayrollSettlementCase
              .includes(
                :assigned_to,
                :target_payroll_calendar_period,
                :included_payroll_batch,
                origin_payroll_batch: :payroll_calendar_period,
                payroll_settlement_case_events: :actor
              )
              .order(:action_due_on, :id)
            scope = scope.where(status: params[:status]) if params[:status].present?
            if params[:external_pay_period_id].present?
              period = PayrollCalendarPeriod.find_by!(external_pay_period_id: params[:external_pay_period_id])
              scope = scope.where(origin_payroll_batch_id: period.payroll_batch_id)
                .or(scope.where(target_payroll_calendar_period_id: period.id))
            end
            queue_summary = summary(scope)
            page = pagination_for(scope, maximum: 250)

            render json: {
              settlement_cases: page.fetch(:records).map { |settlement_case| serialize(settlement_case) },
              pagination: page.fetch(:metadata),
              summary: queue_summary
            }
          end

          def route_case
            run_command(
              action: "payroll_settlement_case.route",
              target: @settlement_case,
              payload: command_params.to_h,
              replay: ->(_current_case, metadata) { { command_result: metadata } },
              response: ->(current_case, _body) { { settlement_case: serialize(current_case) } }
            ) do |locked_case, reason|
              routed = ::Payroll::SettlementCaseRouter.new(
                settlement_case: locked_case,
                destination_kind: command_params[:destination_kind],
                target_external_pay_period_id: command_params[:target_external_pay_period_id],
                action_due_on: command_params[:action_due_on],
                assigned_to_id: command_params[:assigned_to_id],
                reason: reason,
                actor: payroll_actor
              ).call
              [ {}, { destination_kind: routed.destination_kind, target_external_pay_period_id: routed.target_external_pay_period_id, result_version: routed.lock_version }.compact ]
            end
          rescue ::Payroll::SettlementCaseRouter::RoutingError => e
            audit_invalid_command(@settlement_case, e)
            render json: { error: e.message }, status: :unprocessable_entity
          end

          def acknowledge
            run_command(
              action: "payroll_settlement_case.acknowledge",
              target: @settlement_case,
              payload: command_params.to_h,
              replay: ->(_current_case, metadata) { { command_result: metadata } },
              response: ->(current_case, _body) { { settlement_case: serialize(current_case) } }
            ) do |locked_case, _reason|
              updated = ::Payroll::SettlementCaseAcknowledger.new(
                settlement_case: locked_case,
                event_type: command_params[:event_type],
                occurred_at: command_params[:occurred_at],
                actor: payroll_actor,
                metadata: command_params[:metadata]&.to_h || {}
              ).call
              [ {}, { event_type: command_params[:event_type], result_version: updated.lock_version } ]
            end
          rescue ::Payroll::SettlementCaseAcknowledger::AcknowledgementError => e
            audit_invalid_command(@settlement_case, e)
            render json: { error: e.message }, status: :unprocessable_entity
          end

          private

          def set_settlement_case
            @settlement_case = PayrollSettlementCase.find_by!(public_id: params[:id])
          end

          def serialize(settlement_case)
            ::Payroll::SettlementCaseSerializer.new(settlement_case.reload).as_json
          end

          def summary(scope)
            aggregate_scope = scope.except(:includes, :preload, :eager_load, :order)
            counts = aggregate_scope.group(:status).count
            {
              open: counts.fetch("open", 0),
              scheduled: counts.fetch("scheduled", 0),
              in_payroll: counts.fetch("in_payroll", 0),
              settled: counts.fetch("settled", 0),
              attention_due: aggregate_scope.active.where(action_due_on: ..Date.current).count
            }
          end
        end
      end
    end
  end
end
