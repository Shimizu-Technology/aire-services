# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Active Storage security upgrade" do
  let(:photo_path) { Rails.root.join("spec/fixtures/files/team_photo.png") }
  let(:filename) { "team_photo.png" }
  let(:blob) do
    File.open(photo_path) do |file|
      ActiveStorage::Blob.create_and_upload!(io: file, filename: filename, content_type: "image/png")
    end
  end

  after { blob.purge }

  context "when an uploaded filename disagrees with its image content" do
    let(:filename) { "team_photo.avs" }

    it "does not pass the unsafe extension to tools opening the blob" do
      blob.open do |file|
        expect(File.extname(file.path)).not_to eq(".avs")
        expect(File.binread(file.path)).to eq(File.binread(photo_path))
      end
    end
  end

  it "still analyzes uploaded team and site PNG media with vips" do
    expect(ActiveStorage.variant_processor).to eq(:vips)

    blob.analyze

    expect(blob.metadata.fetch("width")).to be_positive
    expect(blob.metadata.fetch("height")).to be_positive
  end

  it "still generates a real image variant" do
    variant = blob.variant(resize_to_limit: [ 8, 8 ]).processed

    expect(variant.download).to start_with("\x89PNG".b)
  end
end
