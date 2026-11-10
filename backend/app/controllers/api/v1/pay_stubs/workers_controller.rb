# frozen_string_literal: true

module Api
  module V1
    module PayStubs
      # People a sender can send stubs to, and each person's check dates.
      class WorkersController < BaseController
        # GET /api/v1/pay_stubs/workers
        def index
          workers = ::PayDocuments.sendable_workers.order(:first_name, :last_name, :id)
          render json: { workers: workers.map { |user| worker_json(user) } }
        end

        # GET /api/v1/pay_stubs/workers/:id
        def show
          render json: { worker: worker_json(find_worker!(params[:id])) }
        end

        # GET /api/v1/pay_stubs/workers/:id/statements
        # Pay dates and periods only, never amounts, so managers can pick stubs.
        def statements
          catalog = ::PayDocuments::StatementCatalog.new(worker: find_worker!(params[:id]))
          entries = ::PayDocuments.with_payroll { catalog.entries }
          render json: { statements: entries.map(&:as_json) }
        end
      end
    end
  end
end
