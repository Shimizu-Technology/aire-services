# frozen_string_literal: true

module Api
  module V1
    module Payroll
      module Cockpit
        class LateHoursController < BaseController
          PAYROLL_COMMAND_CAPABILITY = "settlement_case_management"

          before_action :authenticate_payroll_actor!

          def show
            period = origin_period
            render json: { cases: ::Payroll::LateHours.new(period: period).candidates, period_version: period.lock_version }
          end

          def create
            period = origin_period
            run_command(action: ::Payroll::LateHours::ACTION, target: period, payload: late_hours_params.to_h,
              replay: ->(_period, metadata) { replay_snapshot(metadata) }, status: :created) do |locked_period, _reason|
              batch = ::Payroll::LateHours.new(period: locked_period, actor: payroll_actor).create!(late_hours_params.to_h.deep_symbolize_keys)
              snapshot = batch.export_payload
              # The batch payload is immutable. Save its export envelope too,
              # so retries cannot pick up changed installation capabilities.
              [ { payroll_batch: snapshot }, { payroll_batch_id: batch.public_id, export: snapshot.fetch("export") } ]
            end
          end

          private

          def origin_period
            PayrollCalendarPeriod.find_by!(external_pay_period_id: params[:period_id])
          end

          def late_hours_params
            params.permit(:command_id, :expected_version, :reason, :target_external_pay_period_id, :pay_date, cases: [ :id, :version ])
          end

          def replay_snapshot(metadata)
            batch = PayrollBatch.find_by!(public_id: metadata.fetch("payroll_batch_id"))
            { payroll_batch: batch.payload.deep_dup.merge("export" => metadata.fetch("export")) }
          end
        end
      end
    end
  end
end
