# frozen_string_literal: true

require "net/http"

module Payroll
  # Asks Cornerstone Payroll to change one published period's lock time.
  # Cornerstone owns the calendar, records the change and republishes the
  # period; AIRE applies it only when that publication arrives. It reuses the
  # outbox delivery's Cornerstone origin and shared secret.
  class CutoffChangeClient
    OPEN_TIMEOUT = 3
    READ_TIMEOUT = 10
    WRITE_TIMEOUT = 5
    SCHEMA_VERSION = "1.0"
    BASE_PATH = "/api/v1/integrations/time_payroll/calendar_periods"

    class Error < StandardError; end
    # Cornerstone refused the change (validation, conflict or permission). The
    # message is Cornerstone's own explanation and is safe to show the admin.
    class Rejected < Error
      attr_reader :status

      def initialize(message, status:)
        @status = status
        super(message)
      end
    end
    # Timeouts, network failures, configuration gaps and unexpected responses.
    class Unavailable < Error; end

    Response = Struct.new(:status, :body, keyword_init: true)

    def initialize(env: ENV, http: nil)
      @env = env
      @http = http || method(:perform_post)
    end

    def request_change(external_pay_period_id:, action:, reason:, actor:, request_id:, cutoff_at: nil)
      body = {
        schema_version: SCHEMA_VERSION,
        action: action,
        cutoff_at: cutoff_at&.iso8601,
        reason: reason,
        actor: actor
      }.compact
      response = post(path_for(external_pay_period_id), body, request_id)
      payload = parse_json(response)
      unless (200..299).cover?(response.status)
        message = payload.is_a?(Hash) && payload["error"].is_a?(String) ? payload["error"].truncate(300) : nil
        raise Rejected.new(message, status: response.status) if message && [ 404, 409, 422 ].include?(response.status)

        raise Unavailable, "Cornerstone returned HTTP #{response.status}"
      end
      change = payload.is_a?(Hash) ? payload["cutoff_change"] : nil
      raise Unavailable, "Cornerstone returned an unexpected response" unless change.is_a?(Hash) && change["cutoff_at"].present?

      change
    end

    private

    attr_reader :env, :http

    def path_for(external_pay_period_id)
      id = external_pay_period_id.to_s
      raise Unavailable, "This payroll period cannot be changed from AIRE" unless id.match?(/\A[0-9a-f-]{36}\z/i)

      "#{BASE_PATH}/#{id}/cutoff_change"
    end

    def post(path, body, request_id)
      uri = origin.dup
      uri.path = path
      response = http.call(uri, request_headers(request_id), body.to_json)
      status = Integer(response.code)
      raise Unavailable, "Cornerstone returned HTTP #{status}" if status >= 500 || [ 401, 403 ].include?(status)

      Response.new(status: status, body: response.body)
    rescue Unavailable
      raise
    rescue StandardError => e
      # Messages carry the failure class only, never URLs, secrets or bodies.
      raise Unavailable, "Cornerstone lock-time request failed (#{e.class.name})"
    end

    def parse_json(response)
      JSON.parse(response.body.to_s)
    rescue JSON::ParserError
      nil
    end

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
        raise Unavailable, "Cornerstone lock-time destination is not available"
      end
    end

    def request_headers(request_id)
      secret = env["PAYROLL_SHARED_SECRET"].to_s
      raise Unavailable, "PAYROLL_SHARED_SECRET is not configured" if secret.blank?

      {
        "Accept" => "application/json",
        "Content-Type" => "application/json",
        "X-Shared-Secret" => secret,
        "Idempotency-Key" => request_id
      }
    end

    def perform_post(uri, headers, body)
      request = Net::HTTP::Post.new(uri.request_uri, headers)
      request.body = body
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
