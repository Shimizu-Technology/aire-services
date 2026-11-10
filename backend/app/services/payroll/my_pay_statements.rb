# frozen_string_literal: true

module Payroll
  # Self-service pay statements for one signed-in AIRE user. Pay amounts are
  # read from Cornerstone on every request and never stored in AIRE.
  #
  # Ownership of a statement is always verified against this worker's own
  # Cornerstone statement list before a detail or PDF is returned. To avoid a
  # second Cornerstone round trip for every detail view, a short-lived,
  # process-local cache keeps only the worker's statement IDs, pay dates and
  # contractor flag; it never holds amounts and is not shared across processes.
  class MyPayStatements
    OWNERSHIP_TTL = 2.minutes
    OWNERSHIP_CACHE = ActiveSupport::Cache::MemoryStore.new(size: 2.megabytes)

    def self.clear_ownership_cache!
      OWNERSHIP_CACHE.clear
    end

    def initialize(user:, client: WorkerStatementsClient.new)
      @user = user
      @client = client
      @presenter = MyPayPresenter.new(user: user)
    end

    def list
      result = presenter.list(client.statements(source_user_uuid))
      remember_ownership(result)
      result
    end

    def detail(statement_id)
      ownership = verified_ownership!(statement_id)
      worker = ownership.fetch(:worker)
      payload = client.statement(source_user_uuid, statement_id)
      statement = presenter.detail(payload, worker: worker)
      raise WorkerStatementsClient::NotFound, "Statement not found" unless statement && statement[:id] == statement_id.to_s

      { worker: worker, statement: statement }
    end

    def pdf(statement_id)
      ownership = verified_ownership!(statement_id)
      { body: client.statement_pdf(source_user_uuid, statement_id), pay_date: ownership.fetch(:pay_dates)[statement_id.to_s] }
    end

    private

    attr_reader :user, :client, :presenter

    def source_user_uuid
      user.payroll_integration_uuid
    end

    def cache_key
      "my_pay/ownership/#{user.id}/#{source_user_uuid}"
    end

    def verified_ownership!(statement_id)
      raise WorkerStatementsClient::NotFound, "Statement not found" unless WorkerStatementsClient.valid_statement_id?(statement_id)

      id = statement_id.to_s
      cached = OWNERSHIP_CACHE.read(cache_key)
      return cached if cached && cached.fetch(:pay_dates).key?(id)

      # A miss may be a payroll committed since the cached read; check fresh.
      fresh = remember_ownership(presenter.list(client.statements(source_user_uuid)))
      raise WorkerStatementsClient::NotFound, "Statement not found" unless fresh.fetch(:pay_dates).key?(id)

      fresh
    end

    def remember_ownership(result)
      ownership = {
        worker: result.fetch(:worker),
        pay_dates: result.fetch(:statements).to_h { |statement| [ statement.fetch(:id), statement[:pay_date] ] }
      }
      OWNERSHIP_CACHE.write(cache_key, ownership, expires_in: OWNERSHIP_TTL)
      ownership
    end
  end
end
