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

          workers = ::PayDocuments.sendable_workers.order(:first_name, :last_name, :id)
          rows = ::PayDocuments.with_payroll do
            workers.filter_map do |worker|
              entries = period_entries(worker, period)
              next if entries.empty?

              { worker: worker_json(worker), statements: entries.map { |entry| entry.as_json.except(:run_purpose) },
                links: period_links(worker, period).map { |delivery| delivery_json(delivery) } }
            end
          end
          render json: { workers: rows }
        rescue Date::Error
          render json: { error: "Choose a valid pay period." }, status: :unprocessable_entity
        end

        private

        def period_entries(worker, period)
          ::PayDocuments::StatementCatalog.new(worker: worker).sendable.select do |entry|
            entry.issued && entry.period_start == period.start_date.iso8601 && entry.period_end == period.end_date.iso8601
          end
        rescue ::Payroll::WorkerStatementsClient::NotLinked
          []
        end

        # Not the global last-50 list: an old period must retain its sent state.
        def period_links(worker, period)
          PayDocumentDelivery.where(user: worker)
            .where(id: PayDocumentItem.where(period_start: period.start_date, period_end: period.end_date).select(:pay_document_delivery_id))
            .includes(:user, :sent_by, :revoked_by, :pay_document_items).recent_first
        end
      end
    end
  end
end
