# frozen_string_literal: true

require "digest"
require "net/http"
require "uri"

class AddressGeocodingService
  class GeocodingError < StandardError; end

  BASE_URL = "https://nominatim.openstreetmap.org".freeze
  DEFAULT_LIMIT = 5
  CACHE_TTL = 12.hours
  RATE_LIMIT_WINDOW = 1.minute
  RATE_LIMIT_MAX_REQUESTS = 10

  class << self
    def search(query:, limit: DEFAULT_LIMIT)
      raise GeocodingError, "Address query is required" if query.blank?

      normalized_query = query.to_s.strip
      normalized_limit = limit.to_i.clamp(1, 10)

      Rails.cache.fetch(cache_key(normalized_query, normalized_limit), expires_in: CACHE_TTL) do
        enforce_rate_limit!

        uri = URI("#{BASE_URL}/search")
        uri.query = URI.encode_www_form(
          q: normalized_query,
          format: "jsonv2",
          addressdetails: 1,
          limit: normalized_limit
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
      end
    rescue JSON::ParserError => e
      raise GeocodingError, "Geocoding response could not be parsed: #{e.message}"
    end

    private

    def cache_key(query, limit)
      "address_geocoding:v1:#{Digest::SHA256.hexdigest("#{query.downcase}|#{limit}")}"
    end

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
      Rails.cache.fetch("address_geocoding:user_agent", expires_in: 10.minutes) do
        contact_email = Setting.contact_notification_emails.first.presence || "admin@aireservicesguam.com"
        "AIRE Ops/1.0 (admin-geofence-setup; contact: #{contact_email})"
      end
    end

    def enforce_rate_limit!
      bucket_seconds = RATE_LIMIT_WINDOW.to_i
      now = Time.current.to_i
      bucket = (now / bucket_seconds).to_s
      key = "address_geocoding:rate_limit:#{bucket}"
      expires_in = [bucket_seconds - (now % bucket_seconds), 1].max
      request_count = Rails.cache.increment(key, 1, expires_in: expires_in)
      if request_count.nil?
        initialized = Rails.cache.write(key, 1, expires_in: expires_in, unless_exist: true)
        request_count = initialized ? 1 : Rails.cache.increment(key, 1, expires_in: expires_in)
      end

      request_count ||= RATE_LIMIT_MAX_REQUESTS + 1

      if request_count > RATE_LIMIT_MAX_REQUESTS
        raise GeocodingError, "Geocoding search is temporarily rate-limited. Please try again in a minute."
      end
    end
  end
end
