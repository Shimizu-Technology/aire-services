# frozen_string_literal: true

module Api
  module V1
    module Payroll
      module Cockpit
        class HistoryEntriesController < BaseController
          PAYROLL_COMMAND_CAPABILITY = "settlement_case_management"

          before_action :authenticate_payroll_actor!

          def index
            through_date = parse_through_date!
            validate_pagination!
            # Include source rows with a missing owner. An inner join or a
            # payable-only filter would hide exactly the legacy exceptions
            # this coverage review must account for.
            scope = TimeEntry.where(work_date: ..through_date).includes(:user, :time_category).order(:id)
            page = pagination_for(scope, maximum: 250)
            entries = page.fetch(:records).to_a
            lifecycles = ::Payroll::EntryLifecycleResolver.new(entries: entries).call

            render json: {
              source_state: "current",
              through_work_date: through_date.iso8601,
              time_entries: entries.map { |entry| serialize(entry, lifecycles.fetch(entry.id)) },
              pagination: page.fetch(:metadata)
            }
          rescue ArgumentError => error
            render json: { error: error.message }, status: :unprocessable_entity
          end

          private

          def parse_through_date!
            text = params[:through_work_date].to_s
            unless text.match?(/\A\d{4}-\d{2}-\d{2}\z/)
              raise ArgumentError, "through_work_date must be a valid YYYY-MM-DD date"
            end

            Date.iso8601(text)
          rescue Date::Error
            raise ArgumentError, "through_work_date must be a valid YYYY-MM-DD date"
          end

          def validate_pagination!
            %i[page per_page].each do |key|
              next unless params.key?(key)
              next if params[key].to_s.match?(/\A[1-9]\d*\z/)

              raise ArgumentError, "#{key} must be a positive integer"
            end
          end

          def serialize(entry, lifecycle)
            uuid = entry.user&.payroll_integration_uuid
            review_reasons = []
            review_reasons << "source_owner_missing" unless entry.user
            review_reasons << "source_employee_identity_missing" if uuid.blank?
            review_reasons << "source_owner_not_staff" if entry.user && !entry.user.staff?

            {
              id: entry.id.to_s,
              version: entry.lock_version,
              work_date: entry.work_date.iso8601,
              hours: entry.hours.to_f,
              source_user_uuid: uuid,
              employee: { id: entry.user_id&.to_s, payroll_integration_id: uuid },
              category: entry.time_category && {
                id: entry.time_category.id.to_s, key: entry.time_category.key, name: entry.time_category.name
              },
              state: {
                status: entry.status,
                approval_status: entry.approval_status,
                overtime_status: entry.overtime_status,
                entry_method: entry.entry_method
              },
              lifecycle: lifecycle.slice(:status),
              review_required: review_reasons.any?,
              review_reasons: review_reasons
            }
          end
        end
      end
    end
  end
end
