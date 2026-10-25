# frozen_string_literal: true

# Contains no external-provider readiness requests. ProductionReadiness keeps its
# original live checks for every deployment other than DEPLOYMENT_ENV=staging.
class StagingReadiness
  def initialize(env: ENV)
    @env = env
  end

  def run(live: Rails.env.production?)
    checks = [ check("staging containment settings") { StagingOutboundPolicy.validate!(env: @env) } ]
    checks << check("complete Solid Queue schema exists") { StagingCloneContainment.queue_schema_complete? }
    checks << check("Solid Queue is the effective durable job adapter") { ActiveJob::Base.queue_adapter.is_a?(ActiveJob::QueueAdapters::SolidQueueAdapter) }
    checks << check("staging queue execution ownership matches the selected topology") { @env["SOLID_QUEUE_IN_PUMA"] == "true" }
    checks << check("staging clone containment manifest exists") { StagingQuarantine.complete? }
    if live
      checks.concat([
        check("primary database accepts a query") { ActiveRecord::Base.connection.select_value("SELECT 1").to_i == 1 },
        check("all database migrations are current") { ActiveRecord::Migration.check_all_pending!; true },
        check("persisted encrypted data can be decrypted") { decryptable? },
        check("Solid Queue worker has a recent heartbeat") { SolidQueue::Process.where(kind: "Worker", last_heartbeat_at: 5.minutes.ago..).exists? }
      ])
    end
    ProductionReadiness::Report.new(checks: checks)
  end

  private

  def check(name)
    passed = yield == true
    ProductionReadiness::Check.new(name: name, passed: passed, detail: passed ? "verified" : "not verified")
  rescue StandardError => error
    ProductionReadiness::Check.new(name: name, passed: false, detail: "#{error.class.name} while verifying")
  end

  def decryptable?
    # No current AIRE model declares encrypts; check effective configuration and
    # dynamically probe retained encrypted attributes if models add them later.
    Rails.application.eager_load!
    ApplicationRecord.descendants.each do |model|
      next if model.abstract_class? || !model.table_exists? || model.encrypted_attributes.to_a.empty?
      attributes = model.encrypted_attributes.to_a
      model.unscoped.select(model.primary_key, *attributes).find_each do |record|
        attributes.each { |attribute| record.public_send(attribute) }
      end
    end
    %i[primary_key deterministic_key key_derivation_salt].all? do |key|
      Rails.application.config.active_record.encryption.public_send(key).present?
    end
  end
end
