# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Rack::Attack request throttles", type: :request do
  include ActiveSupport::Testing::TimeHelpers

  around do |example|
    previous_enabled = Rack::Attack.enabled
    previous_store = Rack::Attack.cache.store
    Rack::Attack.enabled = true
    Rack::Attack.cache.store = ActiveSupport::Cache::MemoryStore.new
    example.run
  ensure
    Rack::Attack.enabled = previous_enabled
    Rack::Attack.cache.store = previous_store
  end

  it "bounds cockpit traffic without matching unrelated API paths" do
    travel_to(Time.current.change(sec: 0)) do
      300.times { get "/api/v1/payroll/cockpit/throttle-probe" }
      expect(response).to have_http_status(:not_found)

      get "/api/v1/payroll/cockpit/throttle-probe"
      expect(response).to have_http_status(:too_many_requests)
      expect(response.headers.fetch("Retry-After").to_i).to be_positive

      get "/api/v1/payroll/throttle-probe"
      expect(response).to have_http_status(:not_found)
    end
  end

  it "bounds public pay stub link and kiosk pay stub traffic per IP" do
    travel_to(Time.current.change(sec: 0, min: (Time.current.min / 5) * 5)) do
      60.times { post "/api/v1/pay_stub_links/lookup", params: { token: "x" } }
      expect(response).to have_http_status(:not_found)
      post "/api/v1/pay_stub_links/lookup", params: { token: "x" }
      expect(response).to have_http_status(:too_many_requests)

      30.times { post "/api/v1/aire/kiosk/pay_stubs/choices" }
      expect(response).not_to have_http_status(:too_many_requests)
      post "/api/v1/aire/kiosk/pay_stubs"
      expect(response).to have_http_status(:too_many_requests)
    end
  end
end
