# frozen_string_literal: true

require "rails_helper"

RSpec.describe "staging payroll shared-secret authentication", type: :request do
  around do |example|
    original = ENV.to_h
    ENV.update("DEPLOYMENT_ENV" => "staging", "CONNECTED_PAYROLL_MODE" => "enabled", "PAYROLL_SHARED_SECRET" => "n" * 64,
      "STAGING_PAYROLL_SHARED_SECRET" => "n" * 64,
      "PRODUCTION_PAYROLL_SHARED_SECRET_SHA256" => Digest::SHA256.hexdigest("q" * 64))
    ENV.delete("TIME_TRACKING_EXPORT_SECRET")
    example.run
  ensure
    ENV.replace(original)
  end

  def export_with(secret)
    get "/api/v1/payroll/time_summary", params: { start_date: "2026-06-16", end_date: "2026-06-30" }, headers: { "X-Shared-Secret" => secret }
  end

  it "rejects a copied production secret without creating export evidence" do
    ENV.delete("PAYROLL_SHARED_SECRET")
    ENV["TIME_TRACKING_EXPORT_SECRET"] = "q" * 64
    expect { export_with("q" * 64) }.not_to change(ReportExport, :count)
    expect(response).to have_http_status(:service_unavailable)
  end

  it "rejects mismatched runtime credentials and legacy presence without a fallback" do
    ENV["PAYROLL_SHARED_SECRET"] = "q" * 64
    expect { export_with("q" * 64) }.not_to change(ReportExport, :count)
    expect(response).to have_http_status(:service_unavailable)
    ENV["PAYROLL_SHARED_SECRET"] = "n" * 64
    ENV["TIME_TRACKING_EXPORT_SECRET"] = "q" * 64
    export_with("n" * 64)
    expect(response).to have_http_status(:service_unavailable)
  end

  it "accepts only the asserted staging pair secret" do
    export_with("q" * 64)
    expect(response).to have_http_status(:unauthorized)
    expect { export_with("n" * 64) }.to change(ReportExport, :count).by(1)
    expect(response).to have_http_status(:ok)
  end

  %w[production test].each do |deployment|
    it "preserves the existing legacy credential fallback in #{deployment}" do
      ENV["DEPLOYMENT_ENV"] = deployment
      ENV.delete("PAYROLL_SHARED_SECRET")
      ENV["TIME_TRACKING_EXPORT_SECRET"] = "q" * 64
      export_with("q" * 64)
      expect(response).to have_http_status(:ok)
    end
  end
end
