# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Api::V1::Auth", type: :request do
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

  let(:headers) { { "Authorization" => "Bearer live_token" } }
  let(:claims) do
    {
      "sub" => "user_clerk_123",
      "email" => "first.admin@example.com",
      "first_name" => "First",
      "last_name" => "Admin"
    }
  end

  before do
    allow(ClerkAuth).to receive(:verify).with("live_token").and_return(claims)
  end

  it "blocks implicit first-user bootstrap by default" do
    with_env("ALLOW_FIRST_USER_BOOTSTRAP" => nil) do
      post "/api/v1/auth/me", headers: headers

      expect(response).to have_http_status(:forbidden)
      expect(JSON.parse(response.body).fetch("error")).to match(/haven't been invited/i)
      expect(User.count).to eq(0)
    end
  end

  it "allows first-user bootstrap only when explicitly enabled" do
    with_env("ALLOW_FIRST_USER_BOOTSTRAP" => "true") do
      post "/api/v1/auth/me", headers: headers

      expect(response).to have_http_status(:ok)
      expect(User.count).to eq(1)
      expect(User.last).to have_attributes(
        clerk_id: "user_clerk_123",
        email: "first.admin@example.com",
        role: "admin"
      )
    end
  end
end
