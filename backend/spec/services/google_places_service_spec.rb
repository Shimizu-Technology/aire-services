# frozen_string_literal: true

require "rails_helper"

RSpec.describe GooglePlacesService do
  describe ".autocomplete" do
    around do |example|
      original_key = ENV["GOOGLE_MAPS_API_KEY"]
      ENV["GOOGLE_MAPS_API_KEY"] = "test-google-key"
      example.run
      ENV["GOOGLE_MAPS_API_KEY"] = original_key
    end

    it "requests Guam-biased place predictions with a field mask" do
      http = instance_double(Net::HTTP)
      response = double(
        "response",
        body: {
          suggestions: [
            {
              placePrediction: {
                placeId: "places/aire",
                text: { text: "AIRE Services Guam, Barrigada, Guam" },
                structuredFormat: {
                  mainText: { text: "AIRE Services Guam" },
                  secondaryText: { text: "Barrigada, Guam" }
                }
              }
            }
          ]
        }.to_json
      )
      captured_request = nil

      allow(Net::HTTP).to receive(:new).and_return(http)
      allow(http).to receive(:use_ssl=)
      allow(http).to receive(:open_timeout=)
      allow(http).to receive(:read_timeout=)
      allow(http).to receive(:request) do |request|
        captured_request = request
        response
      end
      allow(response).to receive(:is_a?).with(Net::HTTPSuccess).and_return(true)

      suggestions = described_class.autocomplete(query: "AIRE", session_token: "session-123")

      expect(suggestions).to eq([
        {
          place_id: "places/aire",
          description: "AIRE Services Guam, Barrigada, Guam",
          main_text: "AIRE Services Guam",
          secondary_text: "Barrigada, Guam"
        }
      ])
      expect(captured_request["X-Goog-Api-Key"]).to eq("test-google-key")
      expect(captured_request["X-Goog-FieldMask"]).to include("suggestions.placePrediction.placeId")
      expect(JSON.parse(captured_request.body)).to include(
        "input" => "AIRE",
        "sessionToken" => "session-123",
        "includedRegionCodes" => [ "gu" ]
      )
    end
  end

  describe ".details" do
    around do |example|
      original_key = ENV["GOOGLE_MAPS_API_KEY"]
      ENV["GOOGLE_MAPS_API_KEY"] = "test-google-key"
      Rails.cache.clear
      example.run
      Rails.cache.clear
      ENV["GOOGLE_MAPS_API_KEY"] = original_key
    end

    it "returns normalized place coordinates" do
      http = instance_double(Net::HTTP)
      response = double(
        "response",
        body: {
          id: "places/aire",
          displayName: { text: "AIRE Services Guam" },
          formattedAddress: "1780 Admiral Sherman Boulevard, Barrigada, Guam 96913",
          location: { latitude: 13.46913, longitude: 144.79901 },
          plusCode: { globalCode: "7R65FQ9X+MM" }
        }.to_json
      )
      captured_request = nil

      allow(Net::HTTP).to receive(:new).and_return(http)
      allow(http).to receive(:use_ssl=)
      allow(http).to receive(:open_timeout=)
      allow(http).to receive(:read_timeout=)
      allow(http).to receive(:request) do |request|
        captured_request = request
        response
      end
      allow(response).to receive(:is_a?).with(Net::HTTPSuccess).and_return(true)

      place = described_class.details(place_id: "places/aire", session_token: "session-123")

      expect(place).to eq(
        place_id: "places/aire",
        display_name: "AIRE Services Guam",
        formatted_address: "1780 Admiral Sherman Boulevard, Barrigada, Guam 96913",
        latitude: "13.46913",
        longitude: "144.79901",
        plus_code: "7R65FQ9X+MM"
      )
      expect(captured_request.path).to include("sessionToken=session-123")
      expect(captured_request["X-Goog-FieldMask"]).to eq("id,displayName,formattedAddress,location,plusCode")
    end
  end

  it "fails clearly when the API key is missing" do
    original_key = ENV["GOOGLE_MAPS_API_KEY"]
    ENV["GOOGLE_MAPS_API_KEY"] = nil

    expect do
      described_class.autocomplete(query: "AIRE", session_token: "session-123")
    end.to raise_error(GooglePlacesService::PlacesError, /API key is not configured/i)
  ensure
    ENV["GOOGLE_MAPS_API_KEY"] = original_key
  end
end
