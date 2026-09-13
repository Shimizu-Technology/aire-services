# frozen_string_literal: true

require "net/http"

module Payroll
  class OutboxDispatcher
    include RetrySchedule

    OPEN_TIMEOUT = 5
    READ_TIMEOUT = 10
    WRITE_TIMEOUT = 10
    CLAIM_TIMEOUT = 1.minute
    DELIVERY_BATCH_SIZE = 100

    class ConfigurationError < StandardError; end
    class DeliveryError < StandardError
      attr_reader :response_status

      def initialize(message, response_status: nil)
        @response_status = response_status
        super(message)
      end
    end

    class << self
      def call_due(now: Time.current, enqueue: nil)
        enqueue ||= ->(event_id) { PayrollOutboxDeliveryJob.perform_later(event_id) }
        due_at = now || Time.current
        event_ids = PayrollOutboxEvent.due_at(due_at).order(:occurred_at, :id).limit(DELIVERY_BATCH_SIZE).pluck(:id)
        event_ids.map do |event_id|
          enqueue.call(event_id)
          { event_id: event_id, status: "queued" }
        end
      end
    end

    attr_reader :event_id, :now, :env, :client

    def initialize(event_id:, now: Time.current, env: ENV, client: nil)
      @event_id = event_id
      @now = now
      @env = env
      @client = client || method(:post_event)
    end

    def call
      event = claim_event!
      return event if event.is_a?(Hash)

      response = client.call(endpoint_uri, event.payload, request_headers(event))
      status = Integer(response.code)
      unless status.between?(200, 299)
        raise DeliveryError.new("Cornerstone returned HTTP #{status}", response_status: status)
      end

      record_delivery!(status)
    rescue StandardError => e
      record_failure!(e) if @attempt_claimed
      { event_id: persisted_event_id, status: "failed", error: e.message }
    end

    private

    def claim_event!
      PayrollOutboxEvent.transaction do
        event = PayrollOutboxEvent.lock.find(event_id)
        return { event_id: event.event_id, status: "delivered" } if event.delivery_status == "delivered"
        return { event_id: event.event_id, status: "skipped" } unless due?(event)

        event.update!(
          delivery_attempts: event.delivery_attempts + 1,
          last_delivery_attempt_at: now,
          next_delivery_attempt_at: now + CLAIM_TIMEOUT
        )
        @attempt_claimed = true
        event
      end
    end

    def record_delivery!(status)
      PayrollOutboxEvent.transaction do
        event = PayrollOutboxEvent.lock.find(event_id)
        return { event_id: event.event_id, status: "delivered" } if event.delivery_status == "delivered"

        event.update!(
          delivery_status: "delivered",
          next_delivery_attempt_at: nil,
          delivered_at: now,
          last_response_status: status,
          last_error: nil
        )
        record_delivery_audit!(event)
        { event_id: event.event_id, status: "delivered", response_status: status }
      end
    end

    def due?(event)
      event.delivery_status.in?(%w[pending failed]) &&
        (event.next_delivery_attempt_at.nil? || event.next_delivery_attempt_at <= now)
    end

    def endpoint_uri
      value = env["CORNERSTONE_PAYROLL_EVENTS_URL"].to_s.strip
      raise ConfigurationError, "CORNERSTONE_PAYROLL_EVENTS_URL is not configured" if value.blank?

      uri = URI.parse(value)
      allowed = uri.is_a?(URI::HTTPS) || (!Rails.env.production? && uri.is_a?(URI::HTTP))
      raise ConfigurationError, "CORNERSTONE_PAYROLL_EVENTS_URL must use HTTPS" unless allowed && uri.host.present?

      uri
    rescue URI::InvalidURIError
      raise ConfigurationError, "CORNERSTONE_PAYROLL_EVENTS_URL is invalid"
    end

    def request_headers(event)
      secret = env["PAYROLL_SHARED_SECRET"].to_s
      raise ConfigurationError, "PAYROLL_SHARED_SECRET is not configured" if secret.blank?

      {
        "Content-Type" => "application/json",
        "Accept" => "application/json",
        "X-Shared-Secret" => secret,
        "Idempotency-Key" => event.event_id
      }
    end

    def post_event(uri, payload, headers)
      request = Net::HTTP::Post.new(uri.request_uri, headers)
      request.body = JSON.generate(payload)
      Net::HTTP.start(
        uri.host,
        uri.port,
        use_ssl: uri.is_a?(URI::HTTPS),
        open_timeout: OPEN_TIMEOUT,
        read_timeout: READ_TIMEOUT,
        write_timeout: WRITE_TIMEOUT
      ) { |http| http.request(request) }
    end

    def record_delivery_audit!(event)
      AuditLog.record!(
        action: "payroll_outbox_event.delivered",
        actor: nil,
        actor_kind: "system",
        source: "system",
        event_category: "integration",
        auditable: event,
        metadata: {
          event_id: event.event_id,
          event_type: event.event_type,
          delivery_attempts: event.delivery_attempts,
          response_status: event.last_response_status,
          delivered_at: event.delivered_at.iso8601
        }
      )
    end

    def record_failure!(error)
      attempts = nil
      public_event_id = nil
      PayrollOutboxEvent.transaction(requires_new: true) do
        event = PayrollOutboxEvent.lock.find(event_id)
        return if event.delivery_status == "delivered"

        attempts = event.delivery_attempts
        public_event_id = event.event_id
        event.update!(
          delivery_status: "failed",
          next_delivery_attempt_at: now + retry_delay(attempts),
          last_response_status: error.respond_to?(:response_status) ? error.response_status : nil,
          last_error: safe_error(error)
        )
      end
      report_repeated_failure!(
        record_type: "PayrollOutboxEvent",
        record_id: public_event_id,
        attempts: attempts,
        error: error
      )
    rescue ActiveRecord::RecordNotFound
      nil
    end

    def persisted_event_id
      PayrollOutboxEvent.where(id: event_id).pick(:event_id) || event_id
    end
  end
end
