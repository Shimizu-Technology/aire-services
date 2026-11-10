# frozen_string_literal: true

require "net/http"

module Payroll
  # Read-only client for a worker's own Cornerstone pay statements. It reuses
  # the outbox delivery's Cornerstone origin and shared secret. Callers pass the
  # signed-in user's payroll_integration_uuid; this class never accepts a worker
  # identifier from a browser request.
  class WorkerStatementsClient
    OPEN_TIMEOUT = 3
    READ_TIMEOUT = 8
    WRITE_TIMEOUT = 5
    MAX_PDF_BYTES = 10.megabytes
    BASE_PATH = "/api/v1/integrations/time_payroll/workers"
    STATEMENT_ID = /\A[1-9][0-9]{0,17}\z/

    class Error < StandardError; end
    # Cornerstone has no worker mapped to this AIRE user.
    class NotLinked < Error; end
    # The worker exists, but the statement does not belong to them.
    class NotFound < Error; end
    # Timeouts, network failures, configuration gaps and unexpected responses.
    class Unavailable < Error; end

    Response = Struct.new(:status, :body, :content_type, keyword_init: true)

    def self.valid_statement_id?(value)
      STATEMENT_ID.match?(value.to_s)
    end

    def initialize(env: ENV, http: nil)
      @env = env
      @http = http || method(:perform_get)
    end

    def statements(source_user_uuid)
      response = get(statements_path(source_user_uuid), accept: "application/json")
      raise NotLinked, "Worker is not linked to payroll" if response.status == 404

      payload = parse_json!(response)
      unless payload["statements"].is_a?(Array) && payload["worker"].is_a?(Hash)
        raise Unavailable, "Cornerstone returned an unexpected statement list"
      end

      payload
    end

    def statement(source_user_uuid, statement_id)
      response = get("#{statements_path(source_user_uuid)}/#{checked_id(statement_id)}", accept: "application/json")
      raise NotFound, "Statement not found" if response.status == 404

      payload = parse_json!(response)
      raise Unavailable, "Cornerstone returned an unexpected statement" unless payload["id"].present? || payload["statement"].is_a?(Hash)

      payload
    end

    def statement_pdf(source_user_uuid, statement_id)
      response = get("#{statements_path(source_user_uuid)}/#{checked_id(statement_id)}/pdf", accept: "application/pdf")
      raise NotFound, "Statement not found" if response.status == 404
      raise Unavailable, "Cornerstone returned HTTP #{response.status}" unless success?(response)

      body = response.body.to_s
      unless response.content_type.to_s.start_with?("application/pdf") && body.start_with?("%PDF-") && body.bytesize <= MAX_PDF_BYTES
        raise Unavailable, "Cornerstone returned an unexpected statement file"
      end

      body
    end

    private

    attr_reader :env, :http

    def statements_path(source_user_uuid)
      uuid = source_user_uuid.to_s
      raise NotLinked, "Worker is not linked to payroll" unless uuid.match?(/\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/i)

      "#{BASE_PATH}/#{uuid}/statements"
    end

    def checked_id(statement_id)
      raise NotFound, "Statement not found" unless self.class.valid_statement_id?(statement_id)

      statement_id.to_s
    end

    def get(path, accept:)
      uri = origin.dup
      uri.path = path
      response = http.call(uri, request_headers(accept))
      status = Integer(response.code)
      raise Unavailable, "Cornerstone returned HTTP #{status}" if status >= 500 || [ 401, 403 ].include?(status)

      Response.new(status: status, body: response.body, content_type: response["Content-Type"])
    rescue Unavailable, NotFound, NotLinked
      raise
    rescue StandardError => e
      # Messages carry the failure class only, never URLs, secrets or bodies.
      raise Unavailable, "Cornerstone statements request failed (#{e.class.name})"
    end

    def success?(response)
      (200..299).cover?(response.status)
    end

    def parse_json!(response)
      raise Unavailable, "Cornerstone returned HTTP #{response.status}" unless success?(response)

      payload = JSON.parse(response.body.to_s)
      raise Unavailable, "Cornerstone returned an unexpected response" unless payload.is_a?(Hash)

      payload
    rescue JSON::ParserError
      raise Unavailable, "Cornerstone returned an unreadable response"
    end

    # The statements API lives on the same Cornerstone host that receives
    # AIRE's payroll events, so it shares that destination's containment rules.
    def origin
      @origin ||= begin
        value = env["CORNERSTONE_PAYROLL_EVENTS_URL"].to_s.strip
        raise Unavailable, "CORNERSTONE_PAYROLL_EVENTS_URL is not configured" if value.blank?

        StagingOutboundPolicy.integration!(value, env: env)
        uri = URI.parse(value)
        allowed = uri.is_a?(URI::HTTPS) || (!Rails.env.production? && uri.is_a?(URI::HTTP))
        raise Unavailable, "CORNERSTONE_PAYROLL_EVENTS_URL must use HTTPS" unless allowed && uri.host.present?

        uri.class.build(host: uri.host, port: uri.port)
      rescue URI::InvalidURIError, StagingOutboundPolicy::Blocked
        raise Unavailable, "Cornerstone statements destination is not available"
      end
    end

    def request_headers(accept)
      secret = env["PAYROLL_SHARED_SECRET"].to_s
      raise Unavailable, "PAYROLL_SHARED_SECRET is not configured" if secret.blank?

      { "Accept" => accept, "X-Shared-Secret" => secret }
    end

    def perform_get(uri, headers)
      request = Net::HTTP::Get.new(uri.request_uri, headers)
      Net::HTTP.start(
        uri.host,
        uri.port,
        use_ssl: uri.is_a?(URI::HTTPS),
        open_timeout: OPEN_TIMEOUT,
        read_timeout: READ_TIMEOUT,
        write_timeout: WRITE_TIMEOUT
      ) { |connection| connection.request(request) }
    end
  end
end
