# frozen_string_literal: true

module Api
  module V1
    module Payroll
      module Cockpit
        class BaseController < Api::V1::BaseController
          include PayrollCockpitAuthenticatable

          before_action :authenticate_payroll_cockpit!
          after_action :audit_payroll_cockpit_read, if: -> { request.get? && response.successful? }

          private

          def pagination_for(scope, maximum: 100, page_param: :page, per_page_param: :per_page)
            page = [ params[page_param].to_i, 1 ].max
            per_page = params[per_page_param].to_i
            per_page = 50 if per_page <= 0
            per_page = per_page.clamp(1, maximum)
            total_count = scope.count

            {
              records: scope.offset((page - 1) * per_page).limit(per_page),
              metadata: {
                current_page: page,
                per_page: per_page,
                total_count: total_count,
                total_pages: [ (total_count.to_f / per_page).ceil, 1 ].max,
                truncated: total_count > page * per_page
              }
            }
          end

          def parse_period!
            PayrollCalendarPeriod.find_by!(external_pay_period_id: params[:external_pay_period_id].presence || params[:id])
          end

          def payroll_period_entry_scope(period)
            staff_entries = TimeEntry.joins(:user).merge(User.staff)
            nominal = staff_entries.where(work_date: period.start_date..period.end_date)
            return nominal unless period.payroll_batch_id

            represented_ids = PayrollBatchEntry.where(payroll_batch_id: period.payroll_batch_id).pluck(:source_time_entry_id)
            represented_ids.concat(
              PayrollBatchExclusion.where(payroll_batch_id: period.payroll_batch_id).pluck(:source_time_entry_id)
            )
            nominal.or(staff_entries.where(id: represented_ids))
          end

          def command_params
            params.permit(:command_id, :expected_version, :reason, :decision)
          end

          def audit_payroll_cockpit_read
            AuditLog.record!(
              action: "payroll_cockpit.read",
              actor: nil,
              actor_kind: "integration",
              source: "integration",
              event_category: "integration",
              subject_type: "PayrollCockpit",
              subject_id: 0,
              subject_name: "Cornerstone payroll cockpit",
              metadata: { endpoint: request.path, action: action_name }
            )
          end

          def run_command(action:, target:, payload:, replay:, response: nil, status: :ok)
            command = command_params
            reason = command[:reason].to_s.strip

            result = ::Payroll::CockpitCommand.new(
              command_id: command.fetch(:command_id),
              action: action,
              actor: payroll_actor,
              target: target,
              expected_version: command.fetch(:expected_version),
              payload: payload
            ).call do |locked_target|
              raise ::Payroll::CockpitCommand::InvalidCommandError, "reason is required" if reason.blank?

              body, result_metadata = yield(locked_target, reason)
              [ body, status, result_metadata ]
            end

            response_body = if result.replayed
              replay.call(target.reload, result.receipt.result_metadata)
            elsif response
              response.call(target.reload, result.body)
            else
              result.body
            end
            render json: response_body.merge(
              command: { id: command[:command_id], replayed: result.replayed }
            ), status: result.status
          rescue ActionController::ParameterMissing, ::Payroll::CockpitCommand::InvalidCommandError => e
            audit_invalid_command(target, e)
            render json: { error: e.message }, status: :unprocessable_entity
          rescue ::Payroll::CockpitCommand::StaleObjectError, ::Payroll::CockpitCommand::ConflictError => e
            render json: { error: e.message }, status: :conflict
          end

          def audit_invalid_command(target, error)
            AuditLog.record!(
              action: "payroll_cockpit.command_rejected",
              actor: payroll_actor,
              source: "integration",
              outcome: "failed",
              event_category: "payroll",
              auditable: target,
              correlation_id: command_params[:command_id],
              metadata: {
                command_action: action_name,
                expected_version: command_params[:expected_version],
                error: error.message
              }.compact
            )
          rescue StandardError => audit_error
            Rails.logger.warn("Payroll cockpit invalid-command audit failed: #{audit_error.class}: #{audit_error.message}")
          end
        end
      end
    end
  end
end
