# frozen_string_literal: true

require "rails_helper"

RSpec.describe StagingCloneContainment do
  around do |example|
    old = ENV.to_h
    StagingDatabasePolicy::ROUTING_ENV.each { |name| ENV.delete(name) }
    ENV["DEPLOYMENT_ENV"] = "staging"
    # CI may supply DATABASE_URL or TEST_DATABASE_URL with a different host.
    database = ActiveRecord::Base.connection_db_config.configuration_hash
    StagingOutboundPolicy::DATABASE_SETTINGS.each { |name| ENV.delete(name) }
    ENV["DATABASE_URL"] = URI::Generic.build(scheme: "postgresql", host: database.fetch(:host), port: database[:port], path: "/#{database.fetch(:database)}").to_s
    ENV["STAGING_DATABASE_HOSTS"] = database.fetch(:host).downcase
    ENV["PRODUCTION_DATABASE_HOSTS"] = "production-db.example.test"
    ENV["STAGING_TESTER_BINDINGS"] = '[{"user_id":1,"email":"leon@example.test","clerk_subject":"user_leon"},{"user_id":2,"email":"chels@example.test","clerk_subject":"user_chels"}]'
    ENV["STAGING_INTEGRATION_HOSTS"] = "aire-staging.example.test"
    ENV["PRODUCTION_INTEGRATION_HOSTS"] = "aire.example.test"
    ENV["STAGING_AIRE_FRONTEND_ORIGIN"] = "https://aire-web-staging.example.test"
    ENV["STAGING_PAYROLL_FRONTEND_ORIGIN"] = "https://payroll-web-staging.example.test"
    ENV["STAGING_AIRE_BASE_URL"] = "https://aire-staging.example.test"
    ENV["STAGING_PAYROLL_SHARED_SECRET"] = "n" * 64
    ENV["PAYROLL_SHARED_SECRET"] = "n" * 64
    ENV["PRODUCTION_PAYROLL_SHARED_SECRET_SHA256"] = Digest::SHA256.hexdigest("q" * 64)
    ENV.delete("TIME_TRACKING_EXPORT_SECRET")
    example.run
  ensure
    ENV.replace(old)
  end

  it "refuses all clone operations outside staging" do
    ENV["DEPLOYMENT_ENV"] = "production"
    %i[quarantine configure counts].each do |operation|
      expect { described_class.new.public_send(operation) }.to raise_error(StagingOutboundPolicy::ConfigurationError)
    end
  end

  it "rejects a production host and an actual-connection mismatch" do
    ENV["PRODUCTION_DATABASE_HOSTS"] = ENV.fetch("STAGING_DATABASE_HOSTS")
    expect { described_class.new.quarantine(apply: true) }.to raise_error(StagingOutboundPolicy::ConfigurationError)
    ENV["PRODUCTION_DATABASE_HOSTS"] = "production-db.example.test"
    ENV["STAGING_DATABASE_HOSTS"] = "other-clone.example.test"
    ENV["DATABASE_URL"] = "postgresql://other-clone.example.test/test"
    expect { described_class.new.quarantine(apply: true) }.to raise_error(StagingOutboundPolicy::ConfigurationError, /Actual database/)
  end

  it "refuses a partial Solid Queue schema before any containment writes" do
    connection = ActiveRecord::Base.connection
    allow(connection).to receive(:data_source_exists?).and_call_original
    allow(connection).to receive(:data_source_exists?).with("solid_queue_scheduled_executions").and_return(false)
    expect(connection).not_to receive(:execute)
    expect { described_class.new.quarantine(apply: true) }.to raise_error(StagingOutboundPolicy::ConfigurationError, /complete Solid Queue schema/)
  end

  it "defaults to a read-only dry run with no DDL or record writes" do
    statements = []
    listener = ->(_name, _start, _finish, _id, payload) { statements << payload[:sql] }
    ActiveSupport::Notifications.subscribed(listener, "sql.active_record") { described_class.new.quarantine }
    expect(statements.grep(/\A\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)/i)).to be_empty
  end

  it "quarantines copied jobs once, retaining the ID manifest and new staging jobs" do
    copied = SolidQueue::Job.create!(class_name: "ActionMailer::MailDeliveryJob", queue_name: "default", arguments: {}, active_job_id: SecureRandom.uuid)
    service = described_class.new
    service.quarantine(apply: true)
    expect(copied.reload.finished_at).to be_present
    expect(StagingQuarantine.suppressed?("solid_queue_jobs", copied.id)).to eq(true)
    fresh = SolidQueue::Job.create!(class_name: "SyntheticJob", queue_name: "default", arguments: {}, active_job_id: SecureRandom.uuid)
    service.quarantine(apply: true)
    expect(fresh.reload.finished_at).to be_nil
    expect(StagingQuarantine.suppressed?("solid_queue_jobs", fresh.id)).to eq(false)
  end

  it "makes no tester binding writes when provider identity proof fails" do
    leon = create(:user, email: "leon@example.test")
    chels = create(:user, email: "chels@example.test")
    original = [ leon.clerk_id, chels.clerk_id ]
    ENV["STAGING_TESTER_BINDINGS"] = [ { user_id: leon.id, email: leon.email, clerk_subject: "user_leon" }, { user_id: chels.id, email: chels.email, clerk_subject: "user_chels" } ].to_json
    ENV["CLERK_SECRET_KEY"] = "sk_test_synthetic"
    allow(HTTParty).to receive(:get).and_return(double(success?: true, parsed_response: { "id" => "user_leon", "primary_email_address_id" => "primary", "email_addresses" => [ { "id" => "primary", "email_address" => "outsider@example.test", "verification" => { "status" => "verified" } } ] }))
    service = described_class.new
    service.quarantine(apply: true)
    expect { service.configure(apply: true) }.to raise_error(StagingOutboundPolicy::ConfigurationError, /verified primary/)
    expect([ leon.reload.clerk_id, chels.reload.clerk_id ]).to eq(original)
    expect(StagingQuarantine.complete?).to eq(false)
  end

  it "revalidates runtime credentials after the completion marker persists" do
    service = described_class.new
    service.quarantine(apply: true)
    service.send(:mark!, "__containment_complete__")
    ENV.delete("PAYROLL_SHARED_SECRET")
    ENV["TIME_TRACKING_EXPORT_SECRET"] = "q" * 64
    expect(HTTParty).not_to receive(:get)
    expect { StagingExecutionGate.enforce! }.to raise_error(StagingOutboundPolicy::ConfigurationError, /PAYROLL_SHARED_SECRET/)
    expect { service.configure(apply: true) }.to raise_error(StagingOutboundPolicy::ConfigurationError, /PAYROLL_SHARED_SECRET/)
  end

  it "invalidates copied legacy secret settings even for an already configured clone" do
    service = described_class.new
    service.quarantine(apply: true)
    service.send(:mark!, "__containment_complete__")
    legacy = Setting.create!(key: "time_tracking_export_secret", value: "copied-private-legacy-secret")
    service.configure
    expect(legacy.reload.value).to eq("copied-private-legacy-secret")
    service.configure(apply: true)
    expect(Setting.exists?(legacy.id)).to eq(false)
    expect { service.configure(apply: true) }.not_to change(Setting, :count)
  end

  it "clears cloned identities then rebinds original shared production tester subjects using verified reads" do
    ENV.update("STAGING_SHARES_PRODUCTION_CLERK" => "true", "STAGING_SHARES_PRODUCTION_STORAGE" => "true", "STAGING_STORAGE_WRITE_PREFIX" => "staging/2026-10-25/", "CLERK_SECRET_KEY" => "sk_test_synthetic")
    leon = create(:user, email: "leon@example.test", clerk_id: "user_originalleon")
    outsider = create(:user, clerk_id: "user_originaloutsider")
    ENV["STAGING_TESTER_BINDINGS"] = [ { user_id: leon.id, email: leon.email, clerk_subject: leon.clerk_id } ].to_json
    expect(HTTParty).to receive(:get).with("https://api.clerk.com/v1/users/user_originalleon", anything).and_return(double(success?: true, parsed_response: { "id" => leon.clerk_id, "primary_email_address_id" => "primary", "email_addresses" => [ { "id" => "primary", "email_address" => leon.email, "verification" => { "status" => "verified" } } ] }))
    expect(HTTParty).not_to receive(:patch)
    statements = []
    listener = ->(_name, _start, _finish, _id, payload) { statements << payload[:sql] }
    service = described_class.new
    service.quarantine(apply: true)
    ActiveSupport::Notifications.subscribed(listener, "sql.active_record") { service.configure(apply: true) }
    expect(statements.index { |sql| sql.include?("UPDATE users SET clerk_id = 'staging_quarantined_'") }).to be < statements.index { |sql| sql.start_with?('UPDATE "users" SET "clerk_id"') }
    expect(leon.reload.clerk_id).to eq("user_originalleon")
    expect(leon.personal_access_enabled).to eq(true)
    expect(outsider.reload.clerk_id).to eq("staging_quarantined_#{outsider.id}")
    expect(outsider.personal_access_enabled).to eq(false)
  end

  it "rebinds the two existing tester identities, preserves local IDs, and is repeatable" do
    leon = create(:user, email: "leon@example.test")
    chels = create(:user, email: "chels@example.test")
    original_ids = [ leon.id, chels.id ]
    ENV["STAGING_TESTER_BINDINGS"] = [ { user_id: leon.id, email: leon.email, clerk_subject: "user_leon" }, { user_id: chels.id, email: chels.email, clerk_subject: "user_chels" } ].to_json
    allow(StagingTesterIdentity).to receive(:verify!).and_return(StagingOutboundPolicy.tester_records)
    service = described_class.new
    service.quarantine(apply: true)
    service.configure(apply: true)
    service.configure(apply: true)
    expect([ leon.reload.id, chels.reload.id ]).to eq(original_ids)
    expect([ leon.clerk_id, chels.clerk_id ]).to eq(%w[user_leon user_chels])
    expect(StagingQuarantine.complete?).to eq(true)
  end
end
