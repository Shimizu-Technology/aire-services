# frozen_string_literal: true

module Api
  module V1
    module Payroll
      module Cockpit
        class TimeEntryCorrectionsController < BaseController
          PAYROLL_COMMAND_CAPABILITY = "time_correction"

          before_action :authenticate_payroll_actor!

          def create
            entry = TimeEntry
              .joins(:user)
              .merge(User.staff)
              .includes({ user: :assigned_time_categories }, :time_category, :approved_by, :overtime_approved_by, :time_entry_breaks)
              .find(params[:time_entry_id])
            run_command(
              action: "time_entry.correction",
              target: entry,
              payload: command_params.to_h,
              replay: ->(_current_entry, metadata) { { command_result: metadata } },
              response: ->(current_entry, _body) { { time_entry: serialize(current_entry) } }
            ) do |locked_entry, reason|
              corrected = ::Payroll::TimeEntryCorrection.new(
                entry: locked_entry,
                attributes: command_params,
                actor: payroll_actor,
                reason: reason
              ).call
              [ {}, { result_version: corrected.lock_version, approval_status: corrected.approval_status } ]
            end
          rescue ::Payroll::TimeEntryCorrection::CorrectionError => e
            audit_invalid_command(entry, e) if entry
            render json: { error: e.message }, status: :unprocessable_entity
          end

          private

          def serialize(entry)
            entry = TimeEntry
              .includes({ user: :assigned_time_categories }, :time_category, :approved_by, :overtime_approved_by, :time_entry_breaks)
              .find(entry.id)
            lifecycle = ::Payroll::EntryLifecycleResolver.new(entries: [ entry ]).call.fetch(entry.id)
            period = PayrollCalendarPeriod
              .where("start_date <= ? AND end_date >= ?", entry.work_date, entry.work_date)
              .order(cutoff_at: :desc)
              .first
            snapshot = period && ::Payroll::CockpitPeriodSnapshot.new(period: period, entries: [ entry ]).call
            ::Payroll::CockpitTimeEntrySerializer.new(
              entry,
              lifecycle: lifecycle,
              payroll_state: snapshot&.entry_states&.fetch(entry.id, nil)
            ).as_json
          end
        end
      end
    end
  end
end
