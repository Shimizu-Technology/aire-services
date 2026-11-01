# frozen_string_literal: true

# From backend/: bin/rails runner ops/release-day/record-paid-history.rb
# Preview rolls simulated business writes back. The operator supplies a reviewed plan and DB identity.
config = ActiveRecord::Base.connection_db_config.configuration_hash
unless Rails.env.production? && ENV.fetch("DEPLOYMENT_ENV") == "production" &&
    config.fetch(:host) == ENV.fetch("EXPECTED_DB_HOST") &&
    config.fetch(:database) == ENV.fetch("EXPECTED_DB_NAME")
  abort "Wrong Rails/deployment environment or database host/name; refusing paid-history reconciliation"
end
plan = JSON.parse(File.read(ENV.fetch("PAID_HISTORY_PLAN")))
actor = User.find(Integer(ENV.fetch("ACTOR_ID"), 10))
result = Payroll::ReleasePaidHistory.new(plan: plan, actor: actor).call(
  apply: ENV["APPLY"] == "1", expected_digest: ENV["PREVIEW_DIGEST"]
)
puts JSON.pretty_generate(result)
exit 1 if result[:status] == "preview_failed"
