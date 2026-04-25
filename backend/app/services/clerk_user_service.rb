# frozen_string_literal: true

class ClerkUserService
  BASE_URL = "https://api.clerk.com/v1".freeze
  UNCHANGED = Object.new.freeze

  class Error < StandardError; end
  class ConfigurationError < Error; end
  class RequestError < Error; end

  def self.update_user!(...)
    new.update!(...)
  end

  def initialize
    @secret_key = ENV.fetch("CLERK_SECRET_KEY", nil)
    raise ConfigurationError, "CLERK_SECRET_KEY is required to manage Clerk users from admin" if @secret_key.blank?
  end

  def update!(clerk_user_id:, first_name: UNCHANGED, last_name: UNCHANGED)
    updates = {}

    unless first_name.equal?(UNCHANGED)
      normalized_first_name = first_name.to_s.strip
      raise RequestError, "First name is required" if normalized_first_name.blank?

      updates[:first_name] = normalized_first_name
    end

    updates[:last_name] = last_name.to_s.strip.presence unless last_name.equal?(UNCHANGED)

    patch_user!(clerk_user_id, updates) if updates.present?
  end

  private

  def patch_user!(clerk_user_id, payload)
    request!(:patch, "/users/#{clerk_user_id}", payload)
  end

  def request!(method, path, payload = nil)
    response = HTTParty.send(
      method,
      "#{BASE_URL}#{path}",
      headers: request_headers,
      body: payload&.to_json,
      timeout: 10
    )

    return response.parsed_response if response.success?

    parsed_error = response.parsed_response
    detail = parsed_error["errors"]&.map { |error| error["message"] }.presence&.join(", ") || parsed_error["message"] || response.body
    raise RequestError, "Clerk request failed: #{detail.presence || response.code}"
  rescue HTTParty::Error, Timeout::Error => e
    raise RequestError, "Clerk request failed: #{e.message}"
  end

  def request_headers
    {
      "Authorization" => "Bearer #{@secret_key}",
      "Content-Type" => "application/json"
    }
  end
end
