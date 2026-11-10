# frozen_string_literal: true

module PayDocuments
  # A worker's Cornerstone pay statements reduced to dates. This is what the
  # kiosk and senders pick from: statement ID, pay date and pay period, plus
  # whether the check was voided. Amounts are dropped here and never leave.
  class StatementCatalog
    Entry = Struct.new(:id, :pay_date, :period_start, :period_end, :run_purpose, :voided, keyword_init: true) do
      def as_json(*)
        { id: id, pay_date: pay_date, period_start: period_start, period_end: period_end, run_purpose: run_purpose, voided: voided }
      end

      def year
        pay_date&.slice(0, 4)&.to_i
      end
    end

    def initialize(worker:, client: Payroll::WorkerStatementsClient.new)
      @worker = worker
      @client = client
    end

    # Newest first. Raises WorkerStatementsClient errors when Cornerstone is
    # unreachable or the worker isn't linked.
    def entries
      @entries ||= begin
        payload = client.statements(worker.payroll_integration_uuid)
        Payroll::MyPayPresenter.new(user: worker).list(payload).fetch(:statements).map do |statement|
          Entry.new(
            id: statement.fetch(:id),
            pay_date: statement[:pay_date],
            period_start: statement[:period_start],
            period_end: statement[:period_end],
            run_purpose: statement[:run_purpose],
            voided: statement.dig(:payment, :status) == "voided"
          )
        end.sort_by { |entry| [ entry.pay_date.to_s, entry.id.to_i ] }.reverse
      end
    end

    def sendable
      entries.reject(&:voided)
    end

    def find(id)
      entries.find { |entry| entry.id == id.to_s }
    end

    def latest
      sendable.first
    end

    def for_year(year)
      sendable.select { |entry| entry.year == year.to_i }
    end

    def years
      sendable.filter_map(&:year).uniq.sort.reverse
    end

    attr_reader :worker

    private

    attr_reader :client
  end
end
