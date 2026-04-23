# frozen_string_literal: true

require "rails_helper"

RSpec.describe ClerkAuth do
  let(:rsa_key) { OpenSSL::PKey::RSA.generate(2048) }
  let(:jwk) { JWT::JWK.new(rsa_key, kid: "test-kid") }
  let(:jwks) { { keys: [ jwk.export ] } }

  def with_env(overrides)
    previous = overrides.keys.index_with { |key| ENV[key] }
    overrides.each do |key, value|
      value.nil? ? ENV.delete(key) : ENV[key] = value
    end
    yield
  ensure
    previous.each do |key, value|
      value.nil? ? ENV.delete(key) : ENV[key] = value
    end
  end

  def build_token(issuer:, audience:)
    payload = {
      sub: "user_test",
      iss: issuer,
      aud: audience,
      exp: 1.hour.from_now.to_i
    }

    JWT.encode(payload, rsa_key, "RS256", kid: jwk.kid)
  end

  before do
    allow(described_class).to receive(:fetch_jwks).and_return(jwks)
  end

  it "accepts a token whose issuer and audience match configuration" do
    with_env("CLERK_ISSUER" => "https://clerk.example.com", "CLERK_AUDIENCE" => "aire-api") do
      token = build_token(issuer: "https://clerk.example.com", audience: "aire-api")

      decoded = described_class.verify(token)

      expect(decoded).to include("sub" => "user_test", "iss" => "https://clerk.example.com", "aud" => "aire-api")
    end
  end

  it "rejects a token with the wrong issuer" do
    with_env("CLERK_ISSUER" => "https://clerk.example.com", "CLERK_AUDIENCE" => nil) do
      token = build_token(issuer: "https://other.example.com", audience: "aire-api")

      expect(described_class.verify(token)).to be_nil
    end
  end

  it "rejects a token with the wrong audience when audience validation is configured" do
    with_env("CLERK_ISSUER" => "https://clerk.example.com", "CLERK_AUDIENCE" => "aire-api") do
      token = build_token(issuer: "https://clerk.example.com", audience: "another-api")

      expect(described_class.verify(token)).to be_nil
    end
  end
end
