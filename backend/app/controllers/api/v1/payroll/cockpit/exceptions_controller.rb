# frozen_string_literal: true

module Api
  module V1
    module Payroll
      module Cockpit
        class ExceptionsController < BaseController
          def index
            period = parse_period!
            entries = exception_entries(period)
            page = pagination_for(entries, maximum: 250)
            records = page.fetch(:records).to_a
            lifecycles = ::Payroll::EntryLifecycleResolver.new(entries: records).call
            leave = leave_exceptions(period)
            leave_page = pagination_for(leave, page_param: :leave_page, per_page_param: :leave_per_page)

            render json: {
              payroll_period: period.as_contract_json,
              time_exceptions: records.map do |entry|
                ::Payroll::CockpitTimeEntrySerializer.new(entry, lifecycle: lifecycles[entry.id]).as_json
              end,
              time_exception_pagination: page.fetch(:metadata),
              leave_exceptions: leave_page.fetch(:records).map { |request_record| serialize_leave(request_record) },
              leave_exception_pagination: leave_page.fetch(:metadata),
              carryovers: ::Payroll::CarryoverQueue.new.call
            }
          end

          private

          def exception_entries(period)
            TimeEntry
              .for_payroll_period(period)
              .includes(:user, :time_category, :approved_by, :overtime_approved_by, :time_entry_breaks)
              .where(
                "time_entries.status IN (?) OR time_entries.approval_status IN (?) OR " \
                "(time_entries.entry_method = 'manual' AND time_entries.approval_status IS NULL) OR " \
                "time_entries.overtime_status IN (?)",
                %w[clocked_in on_break],
                %w[pending denied],
                %w[pending denied]
              )
              .order(:work_date, :start_time, :id)
          end

          def leave_exceptions(period)
            LeaveRequest
              .includes(:user, :reviewed_by)
              .where(status: "pending")
              .where("start_date <= ? AND end_date >= ?", period.end_date, period.start_date)
              .order(:start_date, :id)
          end

          def serialize_leave(request_record)
            {
              id: request_record.id.to_s,
              employee: {
                payroll_integration_id: request_record.user.payroll_integration_uuid,
                name: request_record.user.full_name
              },
              leave_type: request_record.leave_type,
              start_date: request_record.start_date.iso8601,
              end_date: request_record.end_date.iso8601,
              total_days: request_record.total_days,
              status: request_record.status,
              reason: request_record.reason,
              created_at: request_record.created_at.iso8601
            }
          end
        end
      end
    end
  end
end
