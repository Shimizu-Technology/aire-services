# frozen_string_literal: true

require "rails_helper"
require_relative "../support/staging_storage_helpers"

RSpec.describe "shared production staging containment" do
  include StagingStorageHelpers

  let(:shared) do
    env = staging_storage_env(provider: :aws)
    env.merge(
      "STAGING_SHARES_PRODUCTION_CLERK" => "true", "STAGING_SHARES_PRODUCTION_STORAGE" => "true",
      "STAGING_STORAGE_WRITE_PREFIX" => "staging/2026-10-25/",
      "STAGING_STORAGE_BUCKET" => env.fetch("PRODUCTION_STORAGE_BUCKET"),
      "AWS_S3_BUCKET" => env.fetch("PRODUCTION_STORAGE_BUCKET"),
      "STAGING_STORAGE_ACCOUNT_ID" => env.fetch("PRODUCTION_STORAGE_ACCOUNT_ID"),
      "AWS_ACCOUNT_ID" => env.fetch("PRODUCTION_STORAGE_ACCOUNT_ID"),
      "STAGING_STORAGE_ACCESS_KEY_SHA256" => env.fetch("PRODUCTION_STORAGE_ACCESS_KEY_SHA256"),
      "AWS_ACCESS_KEY_ID" => "synthetic-live-key",
      "STAGING_STORAGE_ENDPOINT" => env.fetch("PRODUCTION_STORAGE_ENDPOINT"),
      "STAGING_STORAGE_REGION" => "us-west-2", "AWS_REGION" => "us-west-2",
      "CLERK_ISSUER" => "https://synthetic-live.clerk.accounts.dev"
    )
  end

  before do
    allow_any_instance_of(Net::HTTP).to receive(:connect).and_raise("Unexpected network in synthetic storage spec")
  end

  around do |example|
    old = ENV.to_h
    example.run
  ensure
    ENV.replace(old)
  end

  it "accepts the exact paired opt-in and independently asserted shared storage" do
    expect(StagingOutboundPolicy.shared_production_credentials?(shared)).to eq(true)
    expect(StagingStoragePolicy.validate!(env: shared)).to eq(true)
    expect(StagingStoragePolicy.new_key("random", env: shared)).to eq("staging/2026-10-25/random")
    expect(StagingStoragePolicy.new_key("staging/2026-10-25/random", env: shared)).to eq("staging/2026-10-25/random")
  end

  [ [ nil, "true" ], [ "true", nil ], [ "false", "false" ], [ "TRUE", "true" ], [ "true ", "true" ], [ "", "" ], [ "true", "false" ] ].each do |clerk, storage|
    it "fails closed on partial or inexact opt-in #{[ clerk, storage ].inspect}" do
      env = shared.except("STAGING_SHARES_PRODUCTION_CLERK", "STAGING_SHARES_PRODUCTION_STORAGE")
      env["STAGING_SHARES_PRODUCTION_CLERK"] = clerk unless clerk.nil?
      env["STAGING_SHARES_PRODUCTION_STORAGE"] = storage unless storage.nil?
      expect { StagingOutboundPolicy.shared_production_credentials?(env) }.to raise_error(StagingOutboundPolicy::ConfigurationError, /STAGING_SHARES_PRODUCTION/)
    end
  end

  %w[staging/2026-02-29/ staging/2026-04-31/ staging/2026-1-25/ staging/2026-10-25 staging/2026-10-25/../ /staging/2026-10-25/ staging/0000-01-01/].each do |prefix|
    it "rejects an invalid write prefix #{prefix}" do
      expect { StagingOutboundPolicy.shared_production_credentials?(shared.merge("STAGING_STORAGE_WRITE_PREFIX" => prefix)) }.to raise_error(StagingOutboundPolicy::ConfigurationError, /STAGING_STORAGE_WRITE_PREFIX/)
    end
  end

  it "requires a prefix and ignores opt-ins outside staging" do
    expect { StagingOutboundPolicy.shared_production_credentials?(shared.except("STAGING_STORAGE_WRITE_PREFIX")) }.to raise_error(StagingOutboundPolicy::ConfigurationError)
    %w[production development test].each do |mode|
      env = shared.merge("DEPLOYMENT_ENV" => mode, "STAGING_SHARES_PRODUCTION_CLERK" => "typo")
      expect(StagingOutboundPolicy.shared_production_credentials?(env)).to eq(false)
      expect(StagingStoragePolicy.new_key("original", env: env)).to eq("original")
      expect(StagingStoragePolicy.write!("original", env: env)).to eq(true)
    end
    expect(StagingOutboundPolicy.shared_production_credentials?({ "DEPLOYMENT_ENV" => "staging" })).to eq(false)
  end

  it "rejects an orphan storage write prefix without both sharing flags" do
    env = shared.except("STAGING_SHARES_PRODUCTION_CLERK", "STAGING_SHARES_PRODUCTION_STORAGE")
    expect { StagingOutboundPolicy.shared_production_credentials?(env) }.to raise_error(StagingOutboundPolicy::ConfigurationError, /STAGING_STORAGE_WRITE_PREFIX/)
  end

  it "keeps independent storage assertions exact even in shared mode" do
    %w[AWS_S3_BUCKET AWS_ACCOUNT_ID AWS_ACCESS_KEY_ID AWS_REGION].each do |name|
      expect { StagingStoragePolicy.validate!(env: shared.merge(name => "wrong")) }.to raise_error(StagingOutboundPolicy::ConfigurationError)
    end
  end

  it "blocks every Clerk mutation even for bound testers before the provider" do
    env = shared.merge("STAGING_TESTER_BINDINGS" => '[{"user_id":1,"email":"leon@example.test","clerk_subject":"user_leon"}]')
    expect { StagingOutboundPolicy.clerk_target!(id: "user_leon", env: env) }.to raise_error(StagingOutboundPolicy::Blocked, /shared/)
    http = Net::HTTP.new("api.clerk.com", 443)
    http.use_ssl = true
    [ Net::HTTP::Patch.new("/v1/users/user_leon"), Net::HTTP::Post.new("/v1/invitations"), Net::HTTP::Delete.new("/v1/users/user_leon"), Net::HTTP::Put.new("/v1/instance") ].each do |request|
      expect { StagingOutboundPolicy.http_request!(http, request, env: env) }.to raise_error(StagingOutboundPolicy::Blocked, /shared/)
    end
    expect(StagingOutboundPolicy.http_request!(http, Net::HTTP::Get.new("/v1/users/user_leon"), env: env)).to eq(true)
    expect(StagingOutboundPolicy.http_request!(http, Net::HTTP::Get.new("/v1/instance"), env: env)).to eq(true)
    ENV.update(env.merge("CLERK_SECRET_KEY" => "sk_test_synthetic"))
    expect(HTTParty).not_to receive(:patch)
    expect { ClerkUserService.update_user!(clerk_user_id: "user_leon", first_name: "Tester") }.to raise_error(StagingOutboundPolicy::Blocked, /shared/)
  end

  it "rejects misspelled flag names and accepts a real leap-day namespace" do
    expect { StagingOutboundPolicy.shared_production_credentials?(shared.merge("STAGING_SHARES_PRODUCTION_STORGE" => "true")) }.to raise_error(StagingOutboundPolicy::ConfigurationError)
    expect(StagingOutboundPolicy.shared_production_credentials?(shared.merge("STAGING_STORAGE_WRITE_PREFIX" => "staging/2028-02-29/"))).to eq(true)
  end

  it "blocks protected destinations at the final HTTP boundary and allows any-key reads" do
    http = Net::HTTP.new("s3.us-west-2.amazonaws.com", 443)
    http.use_ssl = true
    bucket = shared.fetch("STAGING_STORAGE_BUCKET")
    expect(StagingOutboundPolicy.http_request!(http, Net::HTTP::Get.new("/#{bucket}/production/original"), env: shared)).to eq(true)
    [ Net::HTTP::Put.new("/#{bucket}/production/original"), Net::HTTP::Delete.new("/#{bucket}/production/original"), Net::HTTP::Post.new("/#{bucket}?delete"), Net::HTTP::Put.new("/#{bucket}/staging/2026-10-25/%2e%2e/original") ].each do |request|
      expect { StagingOutboundPolicy.http_request!(http, request, env: shared) }.to raise_error(StagingOutboundPolicy::Blocked)
    end
    expect(StagingOutboundPolicy.http_request!(http, Net::HTTP::Put.new("/#{bucket}/staging/2026-10-25/new"), env: shared)).to eq(true)
  end

  context "the selected S3 adapter" do
    let(:service) do
      ActiveStorage::Service::StagingS3Service.new(bucket: shared.fetch("STAGING_STORAGE_BUCKET"), access_key_id: shared.fetch("AWS_ACCESS_KEY_ID"), secret_access_key: "synthetic-only", region: "us-west-2")
    end

    before { ENV.update(shared) }

    it "does not mutate the ordinary S3 class and selects the adapter only for staging" do
      configs = YAML.safe_load(ERB.new(Rails.root.join("config/storage.yml").read).result, aliases: true)
      expect(configs.dig("amazon", "service")).to eq("StagingS3")
      expect(ActiveStorage::Service::S3Service.ancestors.map(&:name)).not_to include("StagingStorageGuard")
      ENV["DEPLOYMENT_ENV"] = "production"
      configs = YAML.safe_load(ERB.new(Rails.root.join("config/storage.yml").read).result, aliases: true)
      expect(configs.dig("amazon", "service")).to eq("S3")
    end

    it "blocks protected upload, compose destination and metadata without SDK writes" do
      expect(service.client.client).not_to receive(:put_object)
      expect(service.client.client).not_to receive(:create_multipart_upload)
      expect(service.client.client).not_to receive(:copy_object)
      expect { service.upload("production/private.pdf", StringIO.new("x")) }.to raise_error(StagingOutboundPolicy::Blocked)
      expect { service.compose([ "production/source" ], "production/destination") }.to raise_error(StagingOutboundPolicy::Blocked)
      expect { service.update_metadata("production/private.pdf", content_type: "text/plain") }.to raise_error(StagingOutboundPolicy::Blocked)
    end

    it "makes protected object and prefix deletes redacted no-ops before any SDK operation" do
      expect(service.client.client).not_to receive(:delete_object)
      expect(service.client.client).not_to receive(:delete_objects)
      expect(service.bucket).not_to receive(:objects)
      expect(Rails.logger).to receive(:warn).with("STAGING protected storage delete skipped").twice
      service.delete("production/private-secret-name.pdf")
      service.delete_prefixed("variants/production-private-key/")
    end

    it "allows prefixed uploads and any-key reads, and blocks all URL entrypoints" do
      expect(service.client.client).to receive(:put_object).with(hash_including(key: "staging/2026-10-25/new")).and_return(double(data: Aws::S3::Types::PutObjectOutput.new))
      service.upload("staging/2026-10-25/new", StringIO.new("x"))
      allow(service.client.client).to receive(:get_object).and_return(double(data: Aws::S3::Types::GetObjectOutput.new(body: StringIO.new(+"old bytes"))))
      expect(service.download("production/private.pdf")).to eq("old bytes")
      expect { service.url("production/private.pdf", expires_in: 60, disposition: :inline, filename: ActiveStorage::Filename.new("private.pdf"), content_type: "application/pdf") }.to raise_error(StagingOutboundPolicy::Blocked)
      expect { service.url_for_direct_upload("staging/2026-10-25/new", expires_in: 60, content_type: "text/plain", content_length: 1, checksum: "x") }.to raise_error(StagingOutboundPolicy::Blocked)
    end

    it "allows deletions only for newly prefixed staging objects and sub-prefixes" do
      key = "staging/2026-10-25/new"
      expect(service.client.client).to receive(:delete_object).with(hash_including(key: key)).and_return(double(data: Aws::S3::Types::DeleteObjectOutput.new))
      service.delete(key)
      expect(service.bucket).to receive(:objects).with(prefix: "staging/2026-10-25/group").and_return([])
      service.delete_prefixed("staging/2026-10-25/group")
    end

    it "enumerates prefixed deletes through real SDK serialization and the final HTTP guard without bulk POST" do
      calls = []
      allowed = "staging/2026-10-25/group/file"
      injected = "production/injected-file"
      handler = Class.new(Seahorse::Client::Handler) do
        define_method(:call) do |context|
          outgoing = context.http_request
          uri = outgoing.endpoint
          http = Net::HTTP.new(uri.host, uri.port)
          http.use_ssl = uri.scheme == "https"
          request = Net::HTTPGenericRequest.new(outgoing.http_method, false, true, uri.request_uri, outgoing.headers.to_h)
          StagingOutboundPolicy.http_request!(http, request)
          calls << { operation: context.operation_name, method: request.method, path: request.path, key: context.params[:key] }
          response = context.http_response
          response.status_code = 200
          response.headers["content-type"] = "application/xml"
          response.body = if context.operation_name == :list_objects_v2
            StringIO.new("<ListBucketResult xmlns='http://s3.amazonaws.com/doc/2006-03-01/'><IsTruncated>false</IsTruncated><Contents><Key>#{allowed}</Key></Contents><Contents><Key>#{injected}</Key></Contents></ListBucketResult>")
          else
            StringIO.new("")
          end
          data = if context.operation_name == :list_objects_v2
            Aws::S3::Types::ListObjectsV2Output.new(is_truncated: false, contents: [ Aws::S3::Types::Object.new(key: allowed), Aws::S3::Types::Object.new(key: injected) ])
          else
            Aws::S3::Types::DeleteObjectOutput.new
          end
          Seahorse::Client::Response.new(context: context, data: data)
        end
      end
      service.client.client.handlers.remove(Seahorse::Client::NetHttp::Handler)
      service.client.client.handlers.add(handler, step: :send)
      expect { service.delete_prefixed("staging/2026-10-25/group/") }.not_to raise_error
      expect(calls.map { |call| call[:operation] }).to eq([ :list_objects_v2, :delete_object ])
      expect(calls.last).to include(method: "DELETE", key: allowed)
      expect(calls.none? { |call| call[:method] == "POST" || call[:key] == injected }).to eq(true)
    end

    it "rejects sibling prefixes, traversal and malformed shared keys" do
      [ "staging/2026-10-24/x", "staging/2026-10-25evil/x", "staging/2026-10-25/../x", "staging/2026-10-25/", "staging/2026-10-25/a%2fb" ].each do |key|
        expect { StagingStoragePolicy.write!(key) }.to raise_error(StagingOutboundPolicy::Blocked)
        expect(StagingStoragePolicy.delete_allowed?(key)).to eq(false)
      end
    end

    it "prefixes random keys on new blobs without changing loaded cloned keys" do
      blob = ActiveStorage::Blob.create_and_upload!(io: StringIO.new("new"), filename: "new.txt", service_name: "test")
      expect(blob.key).to match(%r{\Astaging/2026-10-25/[a-z0-9]{28}\z})
      blob.update_column(:key, "production/old-key")
      expect(blob.reload.key).to eq("production/old-key")
    end
  end
end
