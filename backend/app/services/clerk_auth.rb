# frozen_string_literal: true

# Service for verifying Clerk JWT tokens
# Uses Clerk's JWKS (JSON Web Key Set) to verify token signatures
class ClerkAuth
  JWKS_CACHE_KEY = "clerk_jwks"
  JWKS_CACHE_TTL = 1.hour

  class << self
    # Verify a Clerk JWT token
    # @param token [String] The JWT token from the Authorization header
    # @return [Hash, nil] The decoded token payload, or nil if invalid
    def verify(token)
      return nil if token.blank?

      # In test environment, allow special test tokens
      if Rails.env.test? && token.start_with?("test_token_")
        return handle_test_token(token)
      end

      jwks = fetch_jwks
      return nil if jwks.nil?

      decoded = JWT.decode(token, nil, true, {
        algorithms: ["RS256"],
        jwks: jwks
      })

      decoded.first
    rescue JWT::DecodeError => e
      Rails.logger.warn("JWT decode error: #{e.message}")
      nil
    rescue JWT::ExpiredSignature
      Rails.logger.debug("JWT token expired")
      nil
    end

    # Fetch a Clerk user's primary email via the Backend API
    # Requires CLERK_SECRET_KEY env var
    # @param clerk_user_id [String] The Clerk user ID (e.g., "user_abc123")
    # @return [String, nil] The user's primary email, or nil
    def fetch_user_email(clerk_user_id)
      secret_key = ENV.fetch("CLERK_SECRET_KEY", nil)
      return nil unless secret_key.present?

      response = HTTParty.get(
        "https://api.clerk.com/v1/users/#{clerk_user_id}",
        headers: { "Authorization" => "Bearer #{secret_key}" },
        timeout: 5
      )

      if response.success?
        data = response.parsed_response
        primary_id = data.dig("primary_email_address_id")
        addresses = data["email_addresses"] || []
        primary = addresses.find { |a| a["id"] == primary_id } || addresses.first
        primary&.dig("email_address")
      else
        Rails.logger.warn("Clerk API fetch failed for #{clerk_user_id}: #{response.code}")
        nil
      end
    rescue HTTParty::Error, Timeout::Error => e
      Rails.logger.warn("Clerk API error for #{clerk_user_id}: #{e.message}")
      nil
    end

    private

    def fetch_jwks
      # Try to get from cache first
      cached = Rails.cache.read(JWKS_CACHE_KEY)
      return cached if cached.present?

      # Fetch from Clerk
      jwks_uri = jwks_url
      return nil unless jwks_uri

      response = HTTParty.get(jwks_uri, timeout: 5)

      if response.success?
        jwks = response.parsed_response
        Rails.cache.write(JWKS_CACHE_KEY, jwks, expires_in: JWKS_CACHE_TTL)
        jwks
      else
        Rails.logger.error("Failed to fetch Clerk JWKS: #{response.code}")
        nil
      end
    rescue HTTParty::Error, Timeout::Error => e
      Rails.logger.error("Error fetching Clerk JWKS: #{e.message}")
      nil
    end

    def jwks_url
      # Use CLERK_JWKS_URL directly if set, otherwise fall back to building from CLERK_ISSUER
      jwks = ENV.fetch("CLERK_JWKS_URL", nil)
      return jwks if jwks.present?

      # Fallback: build from CLERK_ISSUER
      issuer = ENV.fetch("CLERK_ISSUER", nil)
      if issuer.present?
        "#{issuer}/.well-known/jwks.json"
      else
        Rails.logger.warn("Neither CLERK_JWKS_URL nor CLERK_ISSUER configured")
        nil
      end
    end

    def handle_test_token(token)
      # For testing: test_token_<user_id> returns that user's info
      user_id = token.gsub("test_token_", "")
      user = User.find_by(id: user_id)
      
      if user
        {
          "sub" => user.clerk_id || "test_clerk_#{user.id}",
          "email" => user.email,
          "first_name" => user.first_name,
          "last_name" => user.last_name
        }
      end
    end
  end
end
