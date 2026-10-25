# frozen_string_literal: true

require "rails_helper"
require "vips"

RSpec.describe "shared staging marked photos", type: :request do
  before do
    allow_any_instance_of(Net::HTTP).to receive(:connect).and_raise("Unexpected network in synthetic image spec")
  end

  around do |example|
    old = ENV.to_h
    example.run
  ensure
    ENV.replace(old)
  end

  before do
    @media = create(:site_media)
    @image = Vips::Image.black(640, 300, bands: 3).new_from_image([ 30, 90, 160 ]).pngsave_buffer
    @media.file.attach(io: StringIO.new(@image), filename: "cloned.png", content_type: "image/png")
    ENV.update("DEPLOYMENT_ENV" => "staging", "STAGING_SHARES_PRODUCTION_CLERK" => "true", "STAGING_SHARES_PRODUCTION_STORAGE" => "true", "STAGING_STORAGE_WRITE_PREFIX" => "staging/2026-10-25/")
  end

  it "serves existing cloned photos through signed marked URLs without changing source storage" do
    old_key = @media.file.blob.key
    get "/api/v1/site-media"
    url = response.parsed_body.fetch("site_media").first.fetch("file_url")
    expect(url).to include("/api/v1/staging-images/")
    expect(url).not_to include(old_key)
    expect(response.parsed_body.fetch("site_media").first.fetch("staging_artifact_blocked")).to eq(false)
    get URI(url).request_uri
    expect(response).to have_http_status(:ok)
    expect(response.media_type).to eq("image/png")
    expect(response.headers["Content-Disposition"]).to include("STAGING_")
    expect(response.headers["Cache-Control"]).to include("no-store")
    marked = Vips::Image.new_from_buffer(response.body, "")
    expect(marked.height).to be > 300
    # Visible lettering produces both dark text and light background in the strip.
    footer = marked.crop(0, 300, marked.width, marked.height - 300)
    expect(footer.min).to eq(0)
    expect(footer.max).to eq(255)
    expect(@media.file.download).to eq(@image)
    expect(@media.file.blob.reload.key).to eq(old_key)
  end

  it "rejects tampered, expired-purpose, unattached and non-image blobs" do
    get "/api/v1/staging-images/tampered"
    expect(response).to have_http_status(:not_found)
    get "/api/v1/staging-images/#{@media.file.blob.signed_id}"
    expect(response).to have_http_status(:not_found)
    unattached = ActiveStorage::Blob.create_and_upload!(io: StringIO.new(@image), filename: "unattached.png")
    get "/api/v1/staging-images/#{unattached.signed_id(purpose: :staging_marked_image)}"
    expect(response).to have_http_status(:not_found)
    @media.file.attach(io: StringIO.new("synthetic video"), filename: "held.mp4", content_type: "video/mp4", identify: false)
    get "/api/v1/staging-images/#{@media.file.blob.signed_id(purpose: :staging_marked_image)}"
    expect(response).to have_http_status(:service_unavailable)
    get "/api/v1/site-media"
    expect(response.parsed_body.fetch("site_media").first).to include("file_url" => nil, "staging_artifact_blocked" => true)
  end

  it "holds oversized actual bytes before decoding and returns not found for missing source objects" do
    stub_const("Api::V1::StagingImagesController::MAX_IMAGE_BYTES", 16)
    @media.file.blob.update_column(:byte_size, 1)
    url = "/api/v1/staging-images/#{@media.file.blob.signed_id(purpose: :staging_marked_image)}"
    allow_any_instance_of(ActiveStorage::Blob).to receive(:download).and_yield("x" * 17)
    expect(StagingArtifactLabel).not_to receive(:image)
    get url
    expect(response).to have_http_status(:service_unavailable)
    allow_any_instance_of(ActiveStorage::Blob).to receive(:download).and_raise(ActiveStorage::FileNotFoundError)
    get url
    expect(response).to have_http_status(:not_found)
  end

  it "holds the endpoint outside shared staging and leaves framework redirects blocked" do
    url = "/api/v1/staging-images/#{@media.file.blob.signed_id(purpose: :staging_marked_image)}"
    get "/rails/active_storage/blobs/redirect/#{@media.file.blob.signed_id}/cloned.png"
    expect(response).to have_http_status(:service_unavailable)
    ENV.delete("STAGING_SHARES_PRODUCTION_CLERK")
    ENV.delete("STAGING_SHARES_PRODUCTION_STORAGE")
    ENV.delete("STAGING_STORAGE_WRITE_PREFIX")
    get url
    expect(response).to have_http_status(:not_found)
    get "/api/v1/site-media"
    expect(response.parsed_body.fetch("site_media").first.fetch("file_url")).to be_nil
    ENV["DEPLOYMENT_ENV"] = "production"
    get url
    expect(response).to have_http_status(:not_found)
  end
end
