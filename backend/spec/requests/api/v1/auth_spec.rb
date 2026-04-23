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

  it "returns kiosk setup state for the current user" do
    create(
      :user,
      clerk_id: "user_clerk_123",
      email: "first.admin@example.com",
      role: "employee"
    )

    post "/api/v1/auth/me", headers: headers

    expect(response).to have_http_status(:ok)
    expect(JSON.parse(response.body).dig("user", "kiosk_pin_configured")).to eq(false)
    expect(JSON.parse(response.body).dig("user", "needs_kiosk_pin_setup")).to eq(true)
  end

  describe "POST /api/v1/auth/kiosk_pin" do
    let!(:user) do
      create(
        :user,
        clerk_id: "user_clerk_123",
        email: "first.admin@example.com",
        role: "employee"
      )
    end

    it "lets a staff user set their own kiosk pin" do
      post "/api/v1/auth/kiosk_pin",
           params: { pin: "4826" },
           headers: headers

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body).dig("user", "kiosk_pin_configured")).to eq(true)
      expect(user.reload.verify_kiosk_pin("4826")).to eq(true)
      expect(user.kiosk_enabled).to eq(true)
    end

    it "rejects invalid pins" do
      post "/api/v1/auth/kiosk_pin",
           params: { pin: "12ab" },
           headers: headers

      expect(response).to have_http_status(:unprocessable_entity)
      expect(JSON.parse(response.body).fetch("error")).to match(/must be 4 to 8 digits/i)
    end
  end
end
