require "active_support/core_ext/integer/time"
require_relative "../../lib/queue_runtime"

Rails.application.configure do
  # Settings specified here will take precedence over those in config/application.rb.

  # Code is not reloaded between requests.
  config.enable_reloading = false

  # Eager load code on boot for better performance and memory savings (ignored by Rake tasks).
  config.eager_load = true

  # Full error reports are disabled.
  config.consider_all_requests_local = false

  # Cache assets for far-future expiry since they are all digest stamped.
  config.public_file_server.headers = { "cache-control" => "public, max-age=#{1.year.to_i}" }

  # Enable serving of images, stylesheets, and JavaScripts from an asset server.
  # config.asset_host = "http://assets.example.com"

  # Store durable admin-uploaded media in S3 by default. A controlled staging
  # deployment may explicitly opt into a persistent local volume.
  config.active_storage.service = ENV.fetch("ACTIVE_STORAGE_SERVICE", "amazon").to_sym

  # Render terminates TLS before forwarding requests to Rails. Trust that proxy
  # signal so Rails generates secure URLs and cookies instead of treating the
  # internal hop as plain HTTP.
  force_ssl = ENV.fetch("FORCE_SSL", "true").to_s.downcase == "true"
  config.assume_ssl = ENV.fetch("ASSUME_SSL", force_ssl.to_s).to_s.downcase == "true"

  # Force all access to the app over SSL, use Strict-Transport-Security, and use secure cookies.
  config.force_ssl = force_ssl

  # Skip http-to-https redirect for the default health check endpoint.
  config.ssl_options = { redirect: { exclude: ->(request) { request.path == "/up" } } }

  required_encryption_variables = %w[
    ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY
    ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY
    ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT
  ]
  missing_encryption_variables = required_encryption_variables.select { |name| ENV[name].blank? }
  if missing_encryption_variables.any?
    raise "Missing required Active Record Encryption configuration: #{missing_encryption_variables.join(', ')}"
  end

  # Log to STDOUT with the current request id as a default log tag.
  config.log_tags = [ :request_id ]
  config.logger   = ActiveSupport::TaggedLogging.logger(STDOUT)

  # Change to "debug" to log everything (including potentially personally-identifiable information!).
  config.log_level = ENV.fetch("RAILS_LOG_LEVEL", "info")

  # Prevent health checks from clogging up the logs.
  config.silence_healthcheck_path = "/up"

  # Don't log any deprecations.
  config.active_support.report_deprecations = false

  # Use memory cache (sufficient for JWKS caching, no DB table required)
  config.cache_store = :memory_store

  # Payroll cutoffs and integration delivery must continue without an operator
  # request, so production defaults to the durable Solid Queue runtime. AIRE's
  # single-database deployment intentionally uses Active Record's primary
  # connection rather than Solid Queue's optional separate database role.
  active_job_queue_adapter = QueueRuntime.adapter
  config.active_job.queue_adapter = active_job_queue_adapter.to_sym

  # Ignore bad email addresses and do not raise email delivery errors.
  # Set this to true and configure the email server for immediate delivery to raise delivery errors.
  # config.action_mailer.raise_delivery_errors = false

  # Set host to be used by links generated in mailer templates.
  config.action_mailer.default_url_options = { host: "example.com" }

  # Specify outgoing SMTP server. Remember to add smtp/* credentials via bin/rails credentials:edit.
  # config.action_mailer.smtp_settings = {
  #   user_name: Rails.application.credentials.dig(:smtp, :user_name),
  #   password: Rails.application.credentials.dig(:smtp, :password),
  #   address: "smtp.example.com",
  #   port: 587,
  #   authentication: :plain
  # }

  # Enable locale fallbacks for I18n (makes lookups for any locale fall back to
  # the I18n.default_locale when a translation cannot be found).
  config.i18n.fallbacks = true

  # Do not dump schema after migrations.
  config.active_record.dump_schema_after_migration = false

  # Only use :id for inspections in production.
  config.active_record.attributes_for_inspect = [ :id ]

  # Enable DNS rebinding protection and other `Host` header attacks.
  # config.hosts = [
  #   "example.com",     # Allow requests from example.com
  #   /.*\.example\.com/ # Allow requests from subdomains like `www.example.com`
  # ]
  #
  # Skip DNS rebinding protection for the default health check endpoint.
  # config.host_authorization = { exclude: ->(request) { request.path == "/up" } }

  if ENV["FRONTEND_URL"].present?
    config.action_cable.allowed_request_origins = [ ENV["FRONTEND_URL"] ]
  end
end
