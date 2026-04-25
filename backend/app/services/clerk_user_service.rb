# frozen_string_literal: true

class ClerkUserService
  BASE_URL = "https://api.clerk.com/v1".freeze
  UNCHANGED = Object.new.freeze
  EMAIL_FORMAT = /\A[^@\s]+@[^@\s]+\.[^@\s]+\z/

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

  def update!(clerk_user_id:, email: UNCHANGED, first_name: UNCHANGED, last_name: UNCHANGED)
    clerk_user = fetch_user!(clerk_user_id)
    updates = {}

    unless first_name.equal?(UNCHANGED)
      normalized_first_name = first_name.to_s.strip
      raise RequestError, "First name is required" if normalized_first_name.blank?

      updates[:first_name] = normalized_first_name
    end

    updates[:last_name] = last_name.to_s.strip.presence unless last_name.equal?(UNCHANGED)

    unless email.equal?(UNCHANGED)
      normalized_email = email.to_s.strip.downcase
      raise RequestError, "Clerk-managed users must keep an email address" if normalized_email.blank?
      raise RequestError, "Invalid email format" unless normalized_email.match?(EMAIL_FORMAT)

      primary_email_id = ensure_primary_email_address!(clerk_user_id, clerk_user, normalized_email)
      if primary_email_id.present? && primary_email_id != clerk_user["primary_email_address_id"]
        updates[:primary_email_address_id] = primary_email_id
        updates[:notify_primary_email_address_changed] = true
      end
    end

    patch_user!(clerk_user_id, updates) if updates.present?
    serialize_user(fetch_user!(clerk_user_id))
  end

  private

  def fetch_user!(clerk_user_id)
    request!(:get, "/users/#{clerk_user_id}")
  end

  def patch_user!(clerk_user_id, payload)
    request!(:patch, "/users/#{clerk_user_id}", payload)
  end

  def create_email_address!(clerk_user_id, email)
    request!(
      :post,
      "/email_addresses",
      {
        user_id: clerk_user_id,
        email_address: email,
        verified: true
      }
    )
  end

  def ensure_primary_email_address!(clerk_user_id, clerk_user, email)
    addresses = clerk_user["email_addresses"] || []
    existing = addresses.find { |address| address["email_address"].to_s.casecmp?(email) }
    return existing["id"] if existing.present?

    create_email_address!(clerk_user_id, email).fetch("id")
  end

  def serialize_user(clerk_user)
    primary_email_id = clerk_user["primary_email_address_id"]
    email_addresses = clerk_user["email_addresses"] || []
    primary_email = email_addresses.find { |address| address["id"] == primary_email_id } || email_addresses.first

    {
      email: primary_email&.dig("email_address"),
      first_name: clerk_user["first_name"],
      last_name: clerk_user["last_name"]
    }
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
