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
    user = create(
      :user,
      clerk_id: "user_clerk_123",
      email: "first.admin@example.com",
      role: "employee",
      time_tracking_enabled: true
    )
    user.user_time_categories.create!(time_category: create(:time_category))

    post "/api/v1/auth/me", headers: headers

    expect(response).to have_http_status(:ok)
    expect(JSON.parse(response.body).dig("user", "kiosk_pin_configured")).to eq(false)
    expect(JSON.parse(response.body).dig("user", "needs_kiosk_pin_setup")).to eq(false)
  end

  it "reports when an enabled kiosk user still needs a PIN" do
    user = build(
      :user,
      clerk_id: "user_clerk_123",
      email: "first.admin@example.com",
      role: "employee",
      time_tracking_enabled: true,
      kiosk_enabled: true
    )
    user.skip_kiosk_pin_presence_validation = true
    user.save!
    user.user_time_categories.create!(time_category: create(:time_category))

    post "/api/v1/auth/me", headers: headers

    expect(response).to have_http_status(:ok)
    expect(JSON.parse(response.body).dig("user", "needs_kiosk_pin_setup")).to eq(true)
  end

  it "keeps authentication available when Clerk supplies a conflicting email" do
    user = create(
      :user,
      clerk_id: "user_clerk_123",
      email: "original@example.com",
      role: "employee"
    )
    create(:user, email: "first.admin@example.com")

    post "/api/v1/auth/me", headers: headers

    expect(response).to have_http_status(:ok)
    expect(user.reload.email).to eq("original@example.com")
  end

  it "keeps authentication available when a concurrent profile sync hits the email unique index" do
    user = create(
      :user,
      clerk_id: "user_clerk_123",
      email: "original@example.com",
      role: "employee"
    )
    allow(User).to receive(:find_by).and_call_original
    allow(User).to receive(:find_by).with(clerk_id: "user_clerk_123").and_return(user)
    allow(user).to receive(:update!).and_raise(
      ActiveRecord::RecordNotUnique,
      "Key (lower(email))=(first.admin@example.com) already exists"
    )
    warning = nil
    allow(Rails.logger).to receive(:warn) { |message| warning = message }
    expect(user).to receive(:reload).and_call_original

    post "/api/v1/auth/me", headers: headers

    expect(response).to have_http_status(:ok)
    expect(user.email).to eq("original@example.com")
    expect(warning).to eq("Clerk profile sync skipped for user=#{user.id}: database uniqueness conflict")
    expect(warning).not_to include("first.admin@example.com")
  end

  it "fails closed when an invited user cannot claim a concurrently assigned Clerk ID" do
    invited = create(
      :user,
      clerk_id: "pending_race_123",
      email: "first.admin@example.com",
      role: "employee"
    )
    create(:user, clerk_id: "user_clerk_123", email: "other@example.com")
    invited_relation = instance_double(ActiveRecord::Relation)
    allow(User).to receive(:find_by).and_call_original
    allow(User).to receive(:find_by).with(clerk_id: "user_clerk_123").and_return(nil)
    allow(User).to receive(:where).with(personal_access_enabled: true).and_return(invited_relation)
    allow(invited_relation).to receive(:find_by)
      .with("LOWER(email) = ?", "first.admin@example.com")
      .and_return(invited)
    allow(invited).to receive(:update!).and_raise(
      ActiveRecord::RecordNotUnique,
      "duplicate key value violates unique constraint index_users_on_clerk_id"
    )

    post "/api/v1/auth/me", headers: headers

    expect(response).to have_http_status(:forbidden)
    expect(JSON.parse(response.body).fetch("error")).to match(/haven't been invited/i)
    expect(invited.reload.clerk_id).to eq("pending_race_123")
  end

  it "links an invited user from nested Clerk email-address claims" do
    invited = create(
      :user,
      clerk_id: "pending_123",
      email: "invited@example.com",
      role: "employee"
    )
    allow(ClerkAuth).to receive(:verify).with("live_token").and_return(
      "sub" => "user_nested_123",
      "primary_email_address_id" => "email_primary",
      "email_addresses" => [
        { "id" => "email_primary", "email_address" => "invited@example.com" }
      ]
    )

    post "/api/v1/auth/me", headers: headers

    expect(response).to have_http_status(:ok)
    expect(invited.reload.clerk_id).to eq("user_nested_123")
  end

  it "switches a staged kiosk profile to Clerk only after personal activation" do
    invited = create(
      :user,
      :kiosk_only,
      clerk_id: "pending_staged_123",
      email: "first.admin@example.com",
      personal_access_enabled: true,
      first_name: "Local",
      last_name: "Name"
    )
    original_pin_digest = invited.kiosk_pin_digest

    post "/api/v1/auth/me", headers: headers

    expect(response).to have_http_status(:ok)
    expect(invited.reload).to have_attributes(
      clerk_id: "user_clerk_123",
      profile_source: "clerk",
      first_name: "First",
      last_name: "Admin",
      kiosk_pin_digest: original_pin_digest
    )
  end

  it "denies Clerk sign-in after personal access is removed" do
    create(
      :user,
      :kiosk_only,
      clerk_id: "user_clerk_123",
      first_name: "Kiosk"
    )

    post "/api/v1/auth/me", headers: headers

    expect(response).to have_http_status(:forbidden)
    expect(JSON.parse(response.body).fetch("error")).to match(/personal sign-in is disabled/i)
  end

  it "blocks inactive staff users from signing in" do
    create(
      :user,
      clerk_id: "user_clerk_123",
      email: "first.admin@example.com",
      role: "employee",
      is_active: false
    )

    post "/api/v1/auth/me", headers: headers

    expect(response).to have_http_status(:forbidden)
    expect(JSON.parse(response.body).fetch("error")).to match(/deactivated/i)
  end

  describe "POST /api/v1/auth/kiosk_pin" do
    let!(:user) do
      build(
        :user,
        clerk_id: "user_clerk_123",
        email: "first.admin@example.com",
        role: "employee",
        time_tracking_enabled: true,
        kiosk_enabled: true
      ).tap do |record|
        record.skip_kiosk_pin_presence_validation = true
        record.save!
        record.user_time_categories.create!(time_category: create(:time_category))
      end
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

    it "does not let a staff user enable their own kiosk access" do
      user.update_columns(kiosk_enabled: false)

      post "/api/v1/auth/kiosk_pin",
           params: { pin: "4826" },
           headers: headers

      expect(response).to have_http_status(:unprocessable_entity)
      expect(JSON.parse(response.body).fetch("error")).to match(/administrator to enable kiosk access/i)
      expect(user.reload.kiosk_enabled).to eq(false)
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
