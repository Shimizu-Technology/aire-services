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

  it "advertises cloned image URLs only within the endpoint metadata size limit" do
    limit = Api::V1::StagingImagesController::MAX_IMAGE_BYTES
    @media.file.blob.update_column(:byte_size, limit + 1)
    get "/api/v1/site-media"
    item = response.parsed_body.fetch("site_media").first
    expect(item).to include("staging_artifact_blocked" => true)
    expect(item.values_at("file_url", "file_thumb_url", "file_card_url", "file_hero_url")).to all(be_nil)

    get "/api/v1/staging-images/#{@media.file.blob.signed_id(purpose: :staging_marked_image)}"
    expect(response).to have_http_status(:service_unavailable)

    @media.file.blob.update_column(:byte_size, limit)
    get "/api/v1/site-media"
    item = response.parsed_body.fetch("site_media").first
    expect(item.fetch("staging_artifact_blocked")).to eq(false)
    expect(item.values_at("file_url", "file_thumb_url", "file_card_url", "file_hero_url")).to all(include("/staging-images/"))
  end

  it "reports available admin user photos consistently and retains separate and non-staging responses" do
    admin = bound_admin
    admin.public_team_photo.attach(@media.file.blob)
    get "/api/v1/admin/users/#{admin.id}", headers: admin_headers
    expect(response).to have_http_status(:ok)
    user = response.parsed_body.fetch("user")
    expect(user.fetch("staging_artifact_blocked")).to eq(false)
    expect(user.values_at("public_team_photo_url", "public_team_photo_thumb_url", "public_team_photo_card_url")).to all(include("/staging-images/"))
    get URI(user.fetch("public_team_photo_url")).request_uri
    expect(response).to have_http_status(:ok)
    expect(response.media_type).to eq("image/png")

    %w[STAGING_SHARES_PRODUCTION_CLERK STAGING_SHARES_PRODUCTION_STORAGE STAGING_STORAGE_WRITE_PREFIX].each { |key| ENV.delete(key) }
    get "/api/v1/admin/users/#{admin.id}", headers: admin_headers
    expect(response.parsed_body.fetch("user")).to include("staging_artifact_blocked" => true, "public_team_photo_url" => nil)

    ENV["DEPLOYMENT_ENV"] = "production"
    get "/api/v1/admin/users/#{admin.id}", headers: admin_headers
    user = response.parsed_body.fetch("user")
    expect(user).not_to have_key("staging_artifact_blocked")
    expect(user.fetch("public_team_photo_url")).to include("/rails/active_storage/blobs/")
  end

  it "reports missing, oversized and unsupported admin user photos as held" do
    admin = bound_admin
    get "/api/v1/admin/users/#{admin.id}", headers: admin_headers
    expect(response.parsed_body.fetch("user")).to include("staging_artifact_blocked" => true, "public_team_photo_url" => nil)

    admin.public_team_photo.attach(@media.file.blob)
    @media.file.blob.update_column(:byte_size, Api::V1::StagingImagesController::MAX_IMAGE_BYTES + 1)
    get "/api/v1/admin/users/#{admin.id}", headers: admin_headers
    expect(response.parsed_body.fetch("user")).to include("staging_artifact_blocked" => true, "public_team_photo_url" => nil)

    @media.file.blob.update_columns(byte_size: @image.bytesize, content_type: "image/gif")
    get "/api/v1/admin/users/#{admin.id}", headers: admin_headers
    expect(response.parsed_body.fetch("user")).to include("staging_artifact_blocked" => true, "public_team_photo_url" => nil)
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

  def bound_admin
    admin = create(:user, :admin, clerk_id: "user_phototester")
    ENV["STAGING_TESTER_BINDINGS"] = [ { user_id: admin.id, email: admin.email, clerk_subject: admin.clerk_id } ].to_json
    allow(ClerkAuth).to receive(:verify).and_return({ "sub" => admin.clerk_id, "email" => admin.email })
    admin
  end

  def admin_headers
    { "Authorization" => "Bearer synthetic" }
  end
end
