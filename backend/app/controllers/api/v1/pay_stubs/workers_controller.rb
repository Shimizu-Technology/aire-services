# frozen_string_literal: true

module Api
  module V1
    module PayStubs
      # People a sender can send stubs to, and each person's check dates.
      class WorkersController < BaseController
        # GET /api/v1/pay_stubs/workers
        def index
          workers = ::PayDocuments.sendable_workers.order(:first_name, :last_name, :id)
          render json: { workers: workers.map { |user| worker_json(user) }, can_choose_recipient: can_choose_recipient? }
        end

        # GET /api/v1/pay_stubs/workers/:id
        def show
          render json: { worker: worker_json(find_worker!(params[:id])) }
        end

        # GET /api/v1/pay_stubs/workers/:id/statements
        # Pay dates and periods only, never amounts, so managers can pick stubs.
        # The run purpose (a bonus run, say) is for owners and admins only.
        def statements
          catalog = ::PayDocuments::StatementCatalog.new(worker: find_worker!(params[:id]))
          entries = ::PayDocuments.with_payroll { catalog.entries }
          rows = entries.map(&:as_json)
          rows = rows.map { |row| row.except(:run_purpose) } unless current_user.can_preview_pay?
          render json: { statements: rows }
        end
      end
    end
  end
end
