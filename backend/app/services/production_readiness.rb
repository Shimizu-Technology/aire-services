# frozen_string_literal: true

require "base64"
require "digest/md5"
require "json"
require "mail"
require "net/http"
require "securerandom"
require "stringio"
require "timeout"
require "uri"

class ProductionReadiness
  MAX_PROVIDER_RESPONSE_BYTES = 1.megabyte
  PROVIDER_TOTAL_TIMEOUT_SECONDS = 15
  REQUIRED_RECURRING_JOBS = {
    "finalize_due_payroll_cutoffs" => {
      "class" => "PayrollCutoffFinalizationJob",
      "queue" => "payroll",
      "schedule" => "every minute"
    },
    "deliver_payroll_outbox_events" => {
      "class" => "PayrollOutboxDeliveryJob",
      "queue" => "payroll",
      "schedule" => "every minute"
    }
  }.freeze

  Check = Data.define(:name, :passed, :detail)

  class Report
    attr_reader :checks, :generated_at, :revision

    def initialize(checks:, generated_at: Time.current, revision: ENV.fetch("RENDER_GIT_COMMIT", ENV.fetch("GIT_COMMIT", "unknown")))
      @checks = checks
      @generated_at = generated_at
      @revision = revision
    end

    def passed?
      checks.all?(&:passed)
    end

    def failures
      checks.reject(&:passed)
    end

    def as_json(*)
      {
        generated_at: generated_at.iso8601,
        revision: revision,
        passed: passed?,
        checks: checks.map { |check| { name: check.name, passed: check.passed, detail: check.detail } }
      }
    end
  end

  def initialize(
    env: ENV,
    environment: Rails.env,
    config: Rails.application.config,
    primary_record: ActiveRecord::Base,
    queue_process: SolidQueue::Process,
    job_adapter: ActiveJob::Base.queue_adapter,
    storage_factory: -> { ActiveStorage::Blob.service },
    outbox_events: PayrollOutboxEvent,
    recurring_config: Rails.application.config_for(:recurring),
    http_get: nil,
    http_start: nil,
    monotonic_clock: nil
  )
    @env = env
    @environment = environment
    @config = config
    @primary_record = primary_record
    @queue_process = queue_process
    @job_adapter = job_adapter
    @storage_factory = storage_factory
    @outbox_events = outbox_events
    @recurring_config = recurring_config
    @http_get = http_get || method(:default_http_get)
    @http_start = http_start || method(:default_http_start)
    @monotonic_clock = monotonic_clock || -> { Process.clock_gettime(Process::CLOCK_MONOTONIC) }
  end

  def run(live: environment.production?)
    checks = configuration_checks
    checks.concat(live_dependency_checks) if live
    Report.new(checks: checks)
  end

  private

  attr_reader :env, :environment, :config, :primary_record, :queue_process,
    :job_adapter, :storage_factory, :outbox_events, :recurring_config, :http_get,
    :http_start, :monotonic_clock

  def configuration_checks
    [
      check("RAILS_ENV is production") { environment.production? },
      check("TLS is effectively forced") { config.force_ssl == true && config.assume_ssl == true },
      check("S3 is the effective Active Storage service") { config.active_storage.service.to_sym == :amazon },
      check("Solid Queue is the effective job adapter") do
        job_adapter.instance_of?(ActiveJob::QueueAdapters::SolidQueueAdapter)
      end,
      check("the in-process Solid Queue worker is enabled") { QueueRuntime.solid_queue_in_puma?(env) },
      check("MFA enforcement is attested") { env["REQUIRE_MFA"] == "true" },
      check("the frontend origin is an explicit production HTTPS origin") { production_https_origin?(env["FRONTEND_URL"]) },
      check("production Clerk credentials are configured") { production_clerk_configuration? },
      check("S3 credentials and bucket are configured") { s3_configuration_present? },
      check("Resend credentials and sender are configured") { resend_configuration_present? },
      check("the Cornerstone payroll event destination is production HTTPS") { payroll_destination_valid? },
      check("the payroll integration secret is configured") { env["PAYROLL_SHARED_SECRET"].present? },
      check("Active Record encryption is effectively configured") { active_record_encryption_configured? },
      check("the payroll cutoff and delivery schedules are configured") { recurring_jobs_configured? }
    ]
  end

  def live_dependency_checks
    [
      check("the primary database accepts a query") { select_one(primary_record) },
      check("all database migrations are current") { ActiveRecord::Migration.check_all_pending!; true },
      check("a Solid Queue worker has a recent heartbeat") do
        queue_process.where(kind: "Worker", last_heartbeat_at: 5.minutes.ago..).exists?
      end,
      check("the S3 upload/read/delete round trip succeeds") { storage_round_trip },
      check("the Clerk Backend API accepts the configured key") { clerk_ready? },
      check("the Clerk JWKS endpoint is reachable") { clerk_jwks_ready? },
      check("the Resend sender domain is ready") { resend_ready? },
      check("the Cornerstone payroll API health endpoint is reachable") { cornerstone_ready? },
      check("no payroll event has remained undelivered past the retry window") { no_stale_outbox_events? }
    ]
  end

  def check(name)
    passed = yield == true
    Check.new(name: name, passed: passed, detail: passed ? "verified" : "not verified")
  rescue StandardError => e
    Check.new(name: name, passed: false, detail: "#{e.class.name} while verifying")
  end

  def production_https_origin?(value)
    uri = URI.parse(value.to_s)
    uri.is_a?(URI::HTTPS) &&
      uri.host.present? &&
      uri.port == 443 &&
      uri.userinfo.blank? &&
      [ "", "/" ].include?(uri.path) &&
      uri.query.blank? &&
      uri.fragment.blank?
  rescue URI::InvalidURIError
    false
  end

  def production_clerk_configuration?
    env["CLERK_SECRET_KEY"].to_s.start_with?("sk_live_") && production_https_url?(clerk_jwks_url)
  end

  def s3_configuration_present?
    env.values_at("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION", "AWS_S3_BUCKET").all?(&:present?)
  end

  def resend_configuration_present?
    env["RESEND_API_KEY"].present? && sender_domain.present?
  end

  def payroll_destination_valid?
    uri = URI.parse(env["CORNERSTONE_PAYROLL_EVENTS_URL"].to_s)
    production_https_url?(uri) && uri.path == "/api/v1/integrations/aire/events"
  rescue URI::InvalidURIError
    false
  end

  def production_https_url?(value)
    uri = value.is_a?(URI::Generic) ? value : URI.parse(value.to_s)
    uri.is_a?(URI::HTTPS) &&
      uri.host.present? &&
      uri.port == 443 &&
      uri.userinfo.blank? &&
      uri.query.blank? &&
      uri.fragment.blank?
  rescue URI::InvalidURIError
    false
  end

  def active_record_encryption_configured?
    encryption = config.active_record.encryption
    %i[primary_key deterministic_key key_derivation_salt].all? { |key| encryption.public_send(key).present? }
  end

  def recurring_jobs_configured?
    jobs = recurring_config.to_h.deep_stringify_keys
    REQUIRED_RECURRING_JOBS.all? do |name, expected|
      actual = jobs.fetch(name, {})
      actual.slice(*expected.keys).transform_values { |value| value.to_s.squish.downcase } ==
        expected.transform_values { |value| value.to_s.squish.downcase }
    end
  end

  def select_one(record_class)
    record_class.connection.select_value("SELECT 1").to_i == 1
  end

  def storage_round_trip
    storage = storage_factory.call
    key = "production-readiness/#{SecureRandom.uuid}.txt"
    payload = "aire-services-readiness-#{SecureRandom.hex(24)}"
    checksum = Base64.strict_encode64(Digest::MD5.digest(payload))

    storage.upload(key, StringIO.new(payload), checksum: checksum, content_type: "text/plain")
    storage.download(key) == payload
  ensure
    original_error = $!
    begin
      storage&.delete(key) if key
    rescue StandardError => cleanup_error
      raise cleanup_error unless original_error
    end
  end

  def clerk_ready?
    status, body = http_get.call(URI("https://api.clerk.com/v1/instance"), env.fetch("CLERK_SECRET_KEY"))
    status == 200 && body.is_a?(Hash) && body["id"].present?
  end

  def clerk_jwks_ready?
    status, body = http_get.call(URI(clerk_jwks_url), nil)
    status == 200 && Array(body["keys"]).present?
  end

  def resend_ready?
    status, body = http_get.call(URI("https://api.resend.com/domains"), env.fetch("RESEND_API_KEY"))
    return false unless status == 200

    Array(body["data"]).any? do |domain|
      domain["name"].to_s.casecmp?(sender_domain) &&
        domain["status"] == "verified" &&
        domain.dig("capabilities", "sending") == "enabled"
    end
  end

  def cornerstone_ready?
    destination = URI(env.fetch("CORNERSTONE_PAYROLL_EVENTS_URL"))
    health_uri = URI::HTTPS.build(host: destination.host, port: destination.port, path: "/up")
    status, = http_get.call(health_uri, nil)
    status == 200
  end

  def no_stale_outbox_events?
    outbox_events.where(delivery_status: %w[pending failed])
      .where("occurred_at < ?", 10.minutes.ago)
      .none?
  end

  def clerk_jwks_url
    env["CLERK_JWKS_URL"].presence || "#{env.fetch('CLERK_ISSUER').delete_suffix('/')}/.well-known/jwks.json"
  end

  def sender_domain
    Mail::Address.new(env["MAILER_FROM_EMAIL"].to_s).domain.to_s.downcase.presence
  rescue Mail::Field::ParseError
    nil
  end

  def default_http_get(uri, bearer_token)
    request = Net::HTTP::Get.new(uri)
    request["Authorization"] = "Bearer #{bearer_token}" if bearer_token.present?
    request["Accept"] = "application/json"

    deadline = monotonic_clock.call + PROVIDER_TOTAL_TIMEOUT_SECONDS
    response = nil
    body = +""
    http_start.call(
      uri,
      use_ssl: true,
      open_timeout: bounded_provider_timeout(deadline, 5),
      read_timeout: bounded_provider_timeout(deadline, 10)
    ) do |http|
      http.request(request) do |provider_response|
        response = provider_response
        provider_response.read_body do |chunk|
          http.read_timeout = bounded_provider_timeout(deadline, 10)
          body << chunk
          raise IOError, "Provider response exceeded readiness limit" if body.bytesize > MAX_PROVIDER_RESPONSE_BYTES
        end
      end
    end

    parsed_body = JSON.parse(body)
    [ response.code.to_i, parsed_body ]
  rescue JSON::ParserError
    [ response.code.to_i, {} ]
  end

  def bounded_provider_timeout(deadline, idle_limit)
    remaining = deadline - monotonic_clock.call
    raise Timeout::Error, "Provider readiness deadline exceeded" unless remaining.positive?

    [ idle_limit, remaining ].min
  end

  def default_http_start(uri, **options, &block)
    Net::HTTP.start(uri.host, uri.port, **options, &block)
  end
end
