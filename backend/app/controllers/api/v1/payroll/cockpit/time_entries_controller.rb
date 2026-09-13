# frozen_string_literal: true

module Api
  module V1
    module Payroll
      module Cockpit
        class TimeEntriesController < BaseController
          PAYROLL_COMMAND_CAPABILITY = "time_approval"

          before_action :authenticate_payroll_actor!, only: :approval

          def index
            period = parse_period!
            scope = payroll_period_entry_scope(period)
              .includes({ user: :assigned_time_categories }, :time_category, :approved_by, :overtime_approved_by, :time_entry_breaks)
              .order(:work_date, :start_time, :id)
            scope = scope.where(user_id: params[:employee_id]) if params[:employee_id].present?
            scope = scope.where(approval_status: params[:approval_status]) if params[:approval_status].present?
            page = pagination_for(scope, maximum: 250)
            entries = page.fetch(:records).to_a
            lifecycles = ::Payroll::EntryLifecycleResolver.new(entries: entries).call
            snapshot = ::Payroll::CockpitPeriodSnapshot.new(period: period, entries: entries).call

            render json: {
              payroll_period: period.as_contract_json,
              time_entries: entries.map do |entry|
                ::Payroll::CockpitTimeEntrySerializer.new(
                  entry,
                  lifecycle: lifecycles[entry.id],
                  payroll_state: snapshot.entry_states[entry.id]
                ).as_json
              end,
              pagination: page.fetch(:metadata)
            }
          end

          def approval
            entry = TimeEntry
              .joins(:user)
              .merge(User.staff)
              .includes({ user: :assigned_time_categories }, :time_category, :approved_by, :overtime_approved_by, :time_entry_breaks)
              .find(params[:id])
            decision = command_params[:decision].to_s.strip.downcase
            run_command(
              action: "time_entry.approval",
              target: entry,
              payload: command_params.to_h,
              replay: ->(_current_entry, metadata) { { command_result: metadata } },
              response: ->(current_entry, _body) { serialize_command_entry(current_entry, period_for(current_entry)) }
            ) do |locked_entry, reason|
              unless decision.in?(%w[approve deny])
                raise ::Payroll::CockpitCommand::InvalidCommandError, "decision must be approve or deny"
              end

              reviewed = if decision == "approve"
                TimeClockService.approve_entry(entry: locked_entry, approved_by: payroll_actor, note: reason)
              else
                TimeClockService.deny_entry(entry: locked_entry, denied_by: payroll_actor, note: reason)
              end
              AuditLog.record!(
                action: "payroll_cockpit.time_entry_#{decision == 'approve' ? 'approved' : 'denied'}",
                actor: payroll_actor,
                source: "integration",
                event_category: "payroll",
                outcome: decision == "deny" ? "denied" : "succeeded",
                auditable: reviewed,
                correlation_id: command_params[:command_id],
                metadata: { reason: reason, expected_version: command_params[:expected_version] }
              )
              reviewed.reload
              [
                {},
                { decision: decision, result_version: reviewed.lock_version }
              ]
            end
          rescue TimeClockService::ClockError => e
            audit_invalid_command(entry, e) if entry
            render json: { error: e.message }, status: :unprocessable_entity
          end

          private

          def serialize_command_entry(entry, period)
            entry = TimeEntry
              .includes({ user: :assigned_time_categories }, :time_category, :approved_by, :overtime_approved_by, :time_entry_breaks)
              .find(entry.id)
            lifecycle = ::Payroll::EntryLifecycleResolver.new(entries: [ entry ]).call.fetch(entry.id)
            snapshot = period && ::Payroll::CockpitPeriodSnapshot.new(period: period, entries: [ entry ]).call
            { time_entry: ::Payroll::CockpitTimeEntrySerializer.new(
              entry,
              lifecycle: lifecycle,
              payroll_state: snapshot&.entry_states&.fetch(entry.id, nil)
            ).as_json }
          end

          def period_for(entry)
            PayrollCalendarPeriod
              .where("start_date <= ? AND end_date >= ?", entry.work_date, entry.work_date)
              .order(cutoff_at: :desc)
              .first
          end
        end
      end
    end
  end
end
