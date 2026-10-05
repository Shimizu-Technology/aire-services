# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Employee period evidence", type: :request do
  let(:admin) { create(:user, :admin) }
  let(:employee) { create(:user, :employee) }

  it "requires administrator access" do
    get "/api/v1/admin/users/#{employee.id}/periods", headers: { "Authorization" => "Bearer test_token_#{employee.id}" }
    expect(response).to have_http_status(:forbidden)
  end

  it "returns complete empty evidence without inferring missing pay" do
    get "/api/v1/admin/users/#{employee.id}/periods", headers: { "Authorization" => "Bearer test_token_#{admin.id}" }
    expect(response).to have_http_status(:ok)
    expect(JSON.parse(response.body)).to include("amount_owed" => nil, "periods" => [])
  end

  it "rejects bad queries instead of showing zero work" do
    get "/api/v1/admin/users/#{employee.id}/periods", params: { start_date: "not-date" }, headers: { "Authorization" => "Bearer test_token_#{admin.id}" }
    expect(response).to have_http_status(:unprocessable_entity)
  end

  context "connected payroll" do
    let(:grant) { PayrollIntegrationGrant.issue!(user: admin, capabilities: %w[settlement_case_management]) }
    let(:headers) { { "X-Payroll-Shared-Secret" => "employee-evidence-secret", "X-Aire-Delegation-Token" => grant.issued_token,
                     "X-Payroll-Source-Instance-Id" => Payroll::IntegrationProfile.source_instance_id } }

    around do |example|
      original = ENV["PAYROLL_SHARED_SECRET"]
      ENV["PAYROLL_SHARED_SECRET"] = "employee-evidence-secret"
      example.run
    ensure
      ENV["PAYROLL_SHARED_SECRET"] = original
    end

    it "requires service and administrator delegation" do
      path = "/api/v1/payroll/cockpit/employees/#{employee.id}/periods"
      get path, params: { source_user_uuid: employee.payroll_integration_uuid }
      expect(response).to have_http_status(:unauthorized)
      get path, params: { source_user_uuid: employee.payroll_integration_uuid }, headers: headers.except("X-Aire-Delegation-Token")
      expect(response).to have_http_status(:unauthorized)
      limited = PayrollIntegrationGrant.issue!(user: admin, capabilities: %w[time_approval])
      get path, params: { source_user_uuid: employee.payroll_integration_uuid }, headers: headers.merge("X-Aire-Delegation-Token" => limited.issued_token)
      expect(response).to have_http_status(:forbidden)
    end

    it "requires exact source employee and installation identity" do
      path = "/api/v1/payroll/cockpit/employees/#{employee.id}/periods"
      get path, params: { source_user_uuid: SecureRandom.uuid }, headers: headers
      expect(response).to have_http_status(:conflict)
      get path, params: { source_user_uuid: employee.payroll_integration_uuid }, headers: headers.merge("X-Payroll-Source-Instance-Id" => SecureRandom.uuid)
      expect(response).to have_http_status(:conflict)
      get path, params: { source_user_uuid: employee.payroll_integration_uuid }, headers: headers
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body.dig("employee", "payroll_integration_id")).to eq(employee.payroll_integration_uuid)
    end
  end
end
