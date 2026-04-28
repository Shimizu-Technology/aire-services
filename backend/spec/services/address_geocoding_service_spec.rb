# frozen_string_literal: true

require "rails_helper"

RSpec.describe AddressGeocodingService do
  describe ".search" do
    before do
      Rails.cache.clear
    end

    it "sends a descriptive user agent with a contact email" do
      http = instance_double(Net::HTTP)
      response = double("response", body: '[{"display_name":"AIRE Guam","lat":"13.46913","lon":"144.79901"}]')
      captured_request = nil

      allow(Setting).to receive(:contact_notification_emails).and_return([ "ops@aireservicesguam.com" ])
      allow(Net::HTTP).to receive(:new).and_return(http)
      allow(http).to receive(:use_ssl=)
      allow(http).to receive(:open_timeout=)
      allow(http).to receive(:read_timeout=)
      allow(http).to receive(:request) do |request|
        captured_request = request
        response
      end
      allow(response).to receive(:is_a?).with(Net::HTTPSuccess).and_return(true)

      results = described_class.search(query: "AIRE Guam")

      expect(results).to eq([
        {
          display_name: "AIRE Guam",
          latitude: "13.46913",
          longitude: "144.79901"
        }
      ])
      expect(captured_request["User-Agent"]).to eq("AIRE Ops/1.0 (admin-geofence-setup; contact: ops@aireservicesguam.com)")
      expect(captured_request["Accept"]).to eq("application/json")
    end

    it "rate limits repeated uncached outbound lookups" do
      frozen_time = Time.zone.parse("2026-04-28 10:00:00")
      bucket = "address_geocoding:rate_limit:#{frozen_time.to_i / AddressGeocodingService::RATE_LIMIT_WINDOW.to_i}"

      allow(Time).to receive(:current).and_return(frozen_time)
      allow(Rails.cache).to receive(:read).with(bucket).and_return(AddressGeocodingService::RATE_LIMIT_MAX_REQUESTS)
      expect(Rails.cache).not_to receive(:write)

      expect do
        described_class.send(:enforce_rate_limit!)
      end.to raise_error(AddressGeocodingService::GeocodingError, /temporarily rate-limited/i)
    end
  end
end
