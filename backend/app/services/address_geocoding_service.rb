# frozen_string_literal: true

require "net/http"
require "uri"

class AddressGeocodingService
  class GeocodingError < StandardError; end

  BASE_URL = "https://nominatim.openstreetmap.org".freeze
  DEFAULT_LIMIT = 5

  class << self
    def search(query:, limit: DEFAULT_LIMIT)
      raise GeocodingError, "Address query is required" if query.blank?

      uri = URI("#{BASE_URL}/search")
      uri.query = URI.encode_www_form(
        q: query.to_s.strip,
        format: "jsonv2",
        addressdetails: 1,
        limit: limit.to_i.clamp(1, 10)
      )

      response = perform_request(uri)
      payload = JSON.parse(response.body)
      raise GeocodingError, "Unexpected geocoding response" unless payload.is_a?(Array)

      payload.map do |result|
        {
          display_name: result["display_name"],
          latitude: result["lat"],
          longitude: result["lon"]
        }
      end
    rescue JSON::ParserError => e
      raise GeocodingError, "Geocoding response could not be parsed: #{e.message}"
    end

    private

    def perform_request(uri)
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = uri.scheme == "https"
      http.open_timeout = 5
      http.read_timeout = 8

      request = Net::HTTP::Get.new(uri)
      request["Accept"] = "application/json"
      request["User-Agent"] = geocoding_user_agent

      response = http.request(request)
      return response if response.is_a?(Net::HTTPSuccess)

      raise GeocodingError, "Geocoding lookup failed with status #{response.code}"
    rescue Timeout::Error, Errno::ECONNRESET, Errno::ETIMEDOUT, SocketError => e
      raise GeocodingError, "Geocoding lookup failed: #{e.message}"
    end

    def geocoding_user_agent
      "AIRE Ops/1.0 (admin-geofence-setup)"
    end
  end
end
