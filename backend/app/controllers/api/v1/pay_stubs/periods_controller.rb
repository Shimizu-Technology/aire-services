# frozen_string_literal: true

module Api
  module V1
    module PayStubs
      # Issued stubs for one published period, reduced to dates and send history.
      # Never infer payment from hours or a batch: use the worker's actual checks.
      class PeriodsController < BaseController
        def show
          period = PayrollCalendarPeriod.find_by(start_date: Date.iso8601(params[:start_date].to_s))
          return render json: { error: "That pay period isn't available." }, status: :not_found unless period

          today = Time.current.in_time_zone(PayrollCalendarPeriod::BUSINESS_TIME_ZONE).to_date
          state = ::Payroll::PeriodHandoffState.find(period.start_date)
          if period.pay_date > today && state.handoff_state != "paid"
            return render json: { error: "Pay stubs are available after payday." }, status: :unprocessable_entity
          end

          workers = User.staff.where(id: PayrollBatchEntry.where(payroll_batch_id: period.payroll_batch_id).select(:source_user_id))
            .where("termination_effective_on IS NULL OR termination_effective_on >= ?", period.start_date)
            .order(:first_name, :last_name, :id)
          links = period_links(workers, period).group_by(&:user_id)
          requests = PayDocumentRequest.open_requests.where(user_id: workers.select(:id)).order(:created_at, :id).group_by(&:user_id)
          rows = workers.filter_map do |worker|
            period_row(worker, period, links[worker.id] || [], requests[worker.id] || [])
          end
          render json: { workers: rows }
        rescue Date::Error
          render json: { error: "Choose a valid pay period." }, status: :unprocessable_entity
        end

        private

        def period_row(worker, period, links, requests)
          catalog = ::PayDocuments::StatementCatalog.new(worker: worker)
          entries = period_entries(catalog, period)
          return if entries.empty?

          { worker: worker_json(worker), inactive: !worker.is_active?, lookup_failed: false,
            statements: entries.map { |entry| entry.as_json.except(:run_purpose) },
            open_requests: requests.map { |request| period_request_json(request, catalog.latest&.id) },
            links: links.map { |delivery| delivery_json(delivery) } }
        rescue ::Payroll::WorkerStatementsClient::Error
          { worker: worker_json(worker), inactive: !worker.is_active?, lookup_failed: true,
            statements: [], open_requests: requests.map { |request| period_request_json(request) },
            links: links.map { |delivery| delivery_json(delivery) } }
        end

        def period_request_json(request, latest_id = nil)
          { id: request.id, scope: request.scope, statement_id: request.scope == "latest" ? latest_id : request.document_reference, recipient_kind: request.recipient_kind }
        end

        def period_entries(catalog, period)
          catalog.sendable.select do |entry|
            entry.issued && entry.period_start == period.start_date.iso8601 && entry.period_end == period.end_date.iso8601
          end
        end

        # One history query for the period, without the global last-50 limit.
        def period_links(workers, period)
          PayDocumentDelivery.where(user_id: workers.select(:id))
            .where(id: PayDocumentItem.where(period_start: period.start_date, period_end: period.end_date).select(:pay_document_delivery_id))
            .includes(:user, :sent_by, :revoked_by, :pay_document_items).recent_first
        end
      end
    end
  end
end
