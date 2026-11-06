# frozen_string_literal: true

require "rails_helper"
require_relative "../support/staging_storage_helpers"

RSpec.describe "staging transport boundaries" do
  include StagingStorageHelpers
  around do |example|
    old = ENV.to_h
    ENV["DEPLOYMENT_ENV"] = "staging"
    ENV["CLERK_SECRET_KEY"] = "sk_test_synthetic"
    ENV["STAGING_TESTER_BINDINGS"] = '[{"user_id":1,"email":"leon@example.test","clerk_subject":"user_leon"}]'
    ENV["STAGING_INTEGRATION_HOSTS"] = "aire-staging.example.test"
    ENV["PRODUCTION_INTEGRATION_HOSTS"] = "aire.example.test"
    example.run
  ensure
    ENV.replace(old)
  end

  it "blocks unknown Net::HTTP transports before opening the socket" do
    http = Net::HTTP.new("production.example.test", 443)
    http.use_ssl = true
    expect(http).not_to receive(:connect)
    expect { http.request(Net::HTTP::Post.new("/")) }.to raise_error(StagingOutboundPolicy::Blocked)
  end

  it "rejects storage construction and presigning with copied bucket credentials" do
    ENV.update(staging_storage_env(provider: :aws))
    expect { ActiveStorage::Service::StagingS3Service.new(bucket: "synthetic-live-bucket", access_key_id: "synthetic-staging-key", secret_access_key: "synthetic-only", region: "us-east-1") }.to raise_error(StagingOutboundPolicy::ConfigurationError, /BUCKET/)
    expect { ActiveStorage::Service::StagingS3Service.new(bucket: "synthetic-staging-bucket", access_key_id: "synthetic-live-key", secret_access_key: "synthetic-only", region: "us-east-1") }.to raise_error(StagingOutboundPolicy::ConfigurationError, /ACCESS_KEY/)
  end

  it "blocks Google and Nominatim entry points even without provider credentials" do
    expect { GooglePlacesService.autocomplete(query: "private address", session_token: "synthetic") }.to raise_error(StagingOutboundPolicy::Blocked, /Geocoding/)
    expect { GooglePlacesService.details(place_id: "private", session_token: "synthetic") }.to raise_error(StagingOutboundPolicy::Blocked, /Geocoding/)
    expect { AddressGeocodingService.search(query: "private address") }.to raise_error(StagingOutboundPolicy::Blocked, /Geocoding/)
  end

  it "blocks Clerk profile mutation before transport" do
    expect(HTTParty).not_to receive(:send)
    expect { ClerkUserService.new.update!(clerk_user_id: "user_employee", first_name: "Private") }.to raise_error(StagingOutboundPolicy::Blocked)
  end

  it "rejects a production outbox destination before invoking an injected client" do
    dispatcher = Payroll::OutboxDispatcher.new(event_id: 0, env: ENV.to_h.merge("CORNERSTONE_PAYROLL_EVENTS_URL" => "https://aire.example.test/api/v1/integrations/aire/events"))
    expect { dispatcher.send(:endpoint_uri) }.to raise_error(StagingOutboundPolicy::Blocked)
  end
end
