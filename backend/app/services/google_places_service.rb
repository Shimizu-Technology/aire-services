# frozen_string_literal: true

require "digest"
require "net/http"
require "securerandom"
require "uri"

class GooglePlacesService
  class PlacesError < StandardError; end

  BASE_URL = "https://places.googleapis.com/v1".freeze
  DEFAULT_LIMIT = 5
  CACHE_TTL = 12.hours
  GUAM_CENTER = { latitude: 13.4443, longitude: 144.7937 }.freeze
  GUAM_BIAS_RADIUS_METERS = 50_000

  class << self
    def autocomplete(query:, session_token:, limit: DEFAULT_LIMIT)
      normalized_query = query.to_s.strip
      raise PlacesError, "Address query is required" if normalized_query.blank?

      normalized_token = normalize_session_token(session_token)
      normalized_limit = limit.to_i.clamp(1, 10)

      perform_autocomplete(normalized_query, normalized_token, normalized_limit)
    end

    def details(place_id:, session_token:)
      normalized_place_id = place_id.to_s.strip
      raise PlacesError, "Place ID is required" if normalized_place_id.blank?

      normalized_token = normalize_session_token(session_token)

      Rails.cache.fetch(details_cache_key(normalized_place_id), expires_in: CACHE_TTL) do
        perform_details(normalized_place_id, normalized_token)
      end
    end

    private

    def perform_autocomplete(query, session_token, limit)
      uri = URI("#{BASE_URL}/places:autocomplete")
      body = {
        input: query,
        sessionToken: session_token,
        includedRegionCodes: [ "gu" ],
        locationBias: {
          circle: {
            center: GUAM_CENTER,
            radius: GUAM_BIAS_RADIUS_METERS
          }
        }
      }

      response = perform_request(uri, method: :post, body: body, field_mask: [
        "suggestions.placePrediction.placeId",
        "suggestions.placePrediction.text",
        "suggestions.placePrediction.structuredFormat"
      ].join(","))
      payload = JSON.parse(response.body)
      suggestions = payload.fetch("suggestions", [])
      raise PlacesError, "Unexpected places autocomplete response" unless suggestions.is_a?(Array)

      suggestions.filter_map do |suggestion|
        prediction = suggestion["placePrediction"]
        next unless prediction

        {
          place_id: prediction["placeId"],
          description: prediction.dig("text", "text").presence || prediction.dig("structuredFormat", "mainText", "text"),
          main_text: prediction.dig("structuredFormat", "mainText", "text"),
          secondary_text: prediction.dig("structuredFormat", "secondaryText", "text")
        }
      end.first(limit)
    end

    def perform_details(place_id, session_token)
      uri = URI("#{BASE_URL}/places/#{URI.encode_www_form_component(place_id)}")
      uri.query = URI.encode_www_form(sessionToken: session_token)
      response = perform_request(uri, method: :get, field_mask: "id,displayName,formattedAddress,location,plusCode")
      payload = JSON.parse(response.body)
      location = payload["location"]
      raise PlacesError, "Selected place did not include coordinates" unless location.is_a?(Hash)

      {
        place_id: payload["id"].presence || place_id,
        display_name: payload.dig("displayName", "text").presence || payload["formattedAddress"],
        formatted_address: payload["formattedAddress"],
        latitude: location["latitude"].to_s,
        longitude: location["longitude"].to_s,
        plus_code: payload.dig("plusCode", "globalCode")
      }
    end

    def perform_request(uri, method:, field_mask:, body: nil)
      api_key = ENV["GOOGLE_MAPS_API_KEY"].to_s.strip
      raise PlacesError, "Google Maps API key is not configured" if api_key.blank?

      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = uri.scheme == "https"
      http.open_timeout = 5
      http.read_timeout = 8

      request = method == :post ? Net::HTTP::Post.new(uri) : Net::HTTP::Get.new(uri)
      request["Accept"] = "application/json"
      request["Content-Type"] = "application/json"
      request["X-Goog-Api-Key"] = api_key
      request["X-Goog-FieldMask"] = field_mask
      request.body = JSON.generate(body) if body

      response = http.request(request)
      return response if response.is_a?(Net::HTTPSuccess)

      error_message = parse_error_message(response.body)
      raise PlacesError, error_message.presence || "Google Places lookup failed with status #{response.code}"
    rescue JSON::ParserError => e
      raise PlacesError, "Google Places response could not be parsed: #{e.message}"
    rescue Timeout::Error, Errno::ECONNRESET, Errno::ETIMEDOUT, SocketError => e
      raise PlacesError, "Google Places lookup failed: #{e.message}"
    end

    def normalize_session_token(session_token)
      token = session_token.to_s.strip
      token.presence || SecureRandom.uuid
    end

    def details_cache_key(place_id)
      "google_places:details:v1:#{Digest::SHA256.hexdigest(place_id)}"
    end

    def parse_error_message(body)
      payload = JSON.parse(body)
      payload.dig("error", "message")
    rescue JSON::ParserError
      nil
    end
  end
end
