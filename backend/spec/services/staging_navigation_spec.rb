# frozen_string_literal: true

require "rails_helper"

RSpec.describe "staging browser callback destinations" do
  around do |example|
    old = ENV.to_h
    ENV["DEPLOYMENT_ENV"] = "staging"
    ENV["STAGING_AIRE_FRONTEND_ORIGIN"] = "https://aire-web-staging.example.test"
    ENV["STAGING_PAYROLL_FRONTEND_ORIGIN"] = "https://payroll-web-staging.example.test"
    ENV["PRODUCTION_FRONTEND_HOSTS"] = "custom-production.example.test"
    example.run
  ensure
    ENV.replace(old)
  end

  it "checks authorization and callback URLs at the response boundary" do
    controller = Api::V1::Payroll::AccountLinkSessionsController.new
    ENV["FRONTEND_URL"] = "https://app.aireservicesguam.com"
    expect { controller.send(:authorization_url, "private-token") }.to raise_error(StagingOutboundPolicy::Blocked)
    expect { controller.send(:callback_url, "https://custom-production.example.test/callback", "connected") }.to raise_error(StagingOutboundPolicy::Blocked)
    expect(controller.send(:callback_url, "https://payroll-web-staging.example.test/callback", "connected")).to include("aire_link=connected")
  end

  it "denies mixed-case production aliases even when accidentally approved" do
    ENV["STAGING_AIRE_FRONTEND_ORIGIN"] = "https://Aire-Services.onrender.com"
    expect { StagingOutboundPolicy.frontend_origin!(ENV.fetch("STAGING_AIRE_FRONTEND_ORIGIN")) }.to raise_error(StagingOutboundPolicy::Blocked)
  end
end
