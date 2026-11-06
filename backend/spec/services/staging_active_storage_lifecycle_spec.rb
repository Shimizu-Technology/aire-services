# frozen_string_literal: true

require "rails_helper"
require "vips"
require_relative "../support/staging_storage_helpers"

RSpec.describe "shared staging Active Storage lifecycle" do
  include StagingStorageHelpers
  include ActiveJob::TestHelper

  around do |example|
    old = ENV.to_h
    original_service = ActiveStorage::Blob.service
    original_adapter = ActiveJob::Base.queue_adapter
    ActiveJob::Base.queue_adapter = :test
    example.run
  ensure
    ENV.replace(old)
    ActiveStorage::Blob.service = original_service
    ActiveJob::Base.queue_adapter = original_adapter
  end

  let(:service) do
    ActiveStorage::Service::StagingS3Service.new(bucket: "synthetic-staging-bucket", access_key_id: "synthetic-staging-key", secret_access_key: "synthetic-only", region: "auto", endpoint: ENV.fetch("STAGING_STORAGE_ENDPOINT"), force_path_style: true).tap { |s| s.name = "shared" }
  end
  let(:png) { Vips::Image.black(40, 30, bands: 3).pngsave_buffer }

  before do
    ENV.update(staging_storage_env.merge("STAGING_SHARES_PRODUCTION_CLERK" => "true", "STAGING_SHARES_PRODUCTION_STORAGE" => "true", "STAGING_STORAGE_WRITE_PREFIX" => "staging/2026-10-25/"))
    allow_any_instance_of(Net::HTTP).to receive(:connect).and_raise("Unexpected network in synthetic storage spec")
    ActiveStorage::Blob.service = service
    allow(ActiveStorage::Blob.services).to receive(:fetch).and_call_original
    allow(ActiveStorage::Blob.services).to receive(:fetch).with("shared").and_return(service)
    allow(service.client.client).to receive(:put_object).and_return(double(data: Aws::S3::Types::PutObjectOutput.new))
    allow_any_instance_of(Aws::S3::Object).to receive(:exists?).and_return(true)
    allow(service.client.client).to receive(:head_object).and_return(double(data: Aws::S3::Types::HeadObjectOutput.new(content_length: png.bytesize)))
    allow(service.client.client).to receive(:get_object).and_return(double(data: Aws::S3::Types::GetObjectOutput.new(body: StringIO.new(png))))
  end

  def cloned_blob(key: "production/original")
    ActiveStorage::Blob.create!(key: key, filename: "original.png", byte_size: png.bytesize, checksum: Digest::MD5.base64digest(png), content_type: "image/png", service_name: "shared", metadata: { identified: true })
  end

  it "does not delete protected keys during blob delete, purge, or purge_later" do
    expect(service.client.client).not_to receive(:delete_object)
    expect(service.client.client).not_to receive(:delete_objects)
    expect(service.bucket).not_to receive(:objects)
    cloned_blob.delete
    blob = cloned_blob(key: "production/purge")
    blob.purge
    expect(ActiveStorage::Blob.exists?(blob.id)).to eq(false)
    later = cloned_blob(key: "production/later")
    expect { later.purge_later }.to have_enqueued_job(ActiveStorage::PurgeJob).with(later)
    perform_enqueued_jobs(only: ActiveStorage::PurgeJob)
    expect(ActiveStorage::Blob.exists?(later.id)).to eq(false)
  end

  it "attaches prefixed replacements and detaches protected originals without provider deletes" do
    user = create(:user)
    original = cloned_blob
    user.public_team_photo.attach(original)
    expect(service.client.client).not_to receive(:delete_object)
    user.public_team_photo.attach(io: StringIO.new(png), filename: "new.png", content_type: "image/png")
    expect(user.reload.public_team_photo.blob.key).to match(%r{\Astaging/2026-10-25/[a-z0-9]{28}\z})
    perform_enqueued_jobs(only: ActiveStorage::PurgeJob)
    expect(ActiveStorage::Blob.exists?(original.id)).to eq(false)
    expect(service.client.client).to have_received(:put_object).with(hash_including(key: user.public_team_photo.blob.key))
  end

  it "reads cloned images for analysis without writing provider metadata" do
    blob = cloned_blob
    expect(service.client.client).not_to receive(:put_object)
    expect { blob.analyze }.to raise_error(StagingOutboundPolicy::Blocked)
    expect(blob.reload).to be_analyzed
    expect(blob.metadata).to include("width" => 40, "height" => 30)
    expect { blob.send(:update_service_metadata) }.to raise_error(StagingOutboundPolicy::Blocked)
  end

  it "prefixes tracked variant blobs and blocks untracked variant destinations" do
    blob = cloned_blob
    blob.variant(resize_to_limit: [ 20, 20 ]).processed
    derived = blob.variant_records.first.image.blob
    expect(derived.key).to start_with("staging/2026-10-25/")
    expect(service.client.client).to have_received(:put_object).with(hash_including(key: derived.key))
    expect { service.upload("variants/production/original/digest", StringIO.new(png)) }.to raise_error(StagingOutboundPolicy::Blocked)
  end

  it "retains explicit keys, guards compose destinations before IO, and permits prefixed metadata" do
    blob = cloned_blob
    expect(blob.key).to eq("production/original")
    expect(service.client.client).not_to receive(:create_multipart_upload)
    expect { ActiveStorage::Blob.compose([ blob ], key: "production/destination", filename: "combined.png") }.to raise_error(StagingOutboundPolicy::Blocked)
    expect { service.update_metadata("staging/2026-10-25/new", content_type: "image/png") }.not_to raise_error
    expect(ActiveStorage::Blob.new.key).to start_with("staging/2026-10-25/")
  end
end
