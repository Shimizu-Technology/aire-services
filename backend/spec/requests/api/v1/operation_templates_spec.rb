# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Api::V1::OperationTemplates", type: :request do
  def auth_headers_for(user)
    {
      "Authorization" => "Bearer test-token-#{user.id}",
      "Content-Type" => "application/json"
    }
  end

  def stub_clerk_for(user)
    allow(ClerkAuth).to receive(:verify).and_return(
      {
        "sub" => user.clerk_id,
        "email" => user.email
      }
    )
  end

  let!(:admin) do
    User.create!(
      clerk_id: "spec-admin-operation-templates-request",
      email: "admin-operation-templates-request@example.com",
      role: "admin",
      first_name: "Spec",
      last_name: "Admin"
    )
  end

  let!(:employee) do
    User.create!(
      clerk_id: "spec-employee-operation-templates-request",
      email: "employee-operation-templates-request@example.com",
      role: "employee",
      first_name: "Spec",
      last_name: "Employee"
    )
  end

  let!(:template) do
    OperationTemplate.create!(
      name: "Operations Template Request Base #{SecureRandom.hex(4)}",
      category: "general",
      recurrence_type: "monthly",
      auto_generate: true,
      created_by: admin
    )
  end

  describe "GET /api/v1/operation_templates" do
    it "returns templates for admin users" do
      stub_clerk_for(admin)

      get "/api/v1/operation_templates", headers: auth_headers_for(admin)

      expect(response).to have_http_status(:ok)
      ids = JSON.parse(response.body).fetch("operation_templates").map { |item| item["id"] }
      expect(ids).to include(template.id)
    end

    it "rejects non-admin users" do
      stub_clerk_for(employee)

      get "/api/v1/operation_templates", headers: auth_headers_for(employee)

      expect(response).to have_http_status(:forbidden)
      expect(JSON.parse(response.body)["error"]).to eq("Admin access required")
    end
  end

  describe "POST /api/v1/operation_templates" do
    it "creates valid template for admin" do
      stub_clerk_for(admin)

      post "/api/v1/operation_templates",
           params: {
             operation_template: {
               name: "Created Template #{SecureRandom.hex(4)}",
               category: "payroll",
               recurrence_type: "monthly",
               auto_generate: true
             }
           }.to_json,
           headers: auth_headers_for(admin)

      expect(response).to have_http_status(:created)
      expect(JSON.parse(response.body).dig("operation_template", "category")).to eq("payroll")
    end

    it "validates custom recurrence interval requirement" do
      stub_clerk_for(admin)

      post "/api/v1/operation_templates",
           params: {
             operation_template: {
               name: "Custom Recurrence Missing Interval #{SecureRandom.hex(4)}",
               category: "general",
               recurrence_type: "custom",
               auto_generate: true
             }
           }.to_json,
           headers: auth_headers_for(admin)

      expect(response).to have_http_status(:unprocessable_entity)
      expect(JSON.parse(response.body)["error"].downcase).to include("recurrence interval")
    end
  end

  describe "PATCH /api/v1/operation_templates/:id" do
    it "updates recurrence settings for admin" do
      stub_clerk_for(admin)

      patch "/api/v1/operation_templates/#{template.id}",
            params: {
              operation_template: {
                recurrence_type: "custom",
                recurrence_interval: 10
              }
            }.to_json,
            headers: auth_headers_for(admin)

      expect(response).to have_http_status(:ok)
      payload = JSON.parse(response.body).fetch("operation_template")
      expect(payload["recurrence_type"]).to eq("custom")
      expect(payload["recurrence_interval"]).to eq(10)
    end

    it "rejects non-admin users" do
      stub_clerk_for(employee)

      patch "/api/v1/operation_templates/#{template.id}",
            params: { operation_template: { name: "Unauthorized" } }.to_json,
            headers: auth_headers_for(employee)

      expect(response).to have_http_status(:forbidden)
      expect(JSON.parse(response.body)["error"]).to eq("Admin access required")
    end
  end

  describe "DELETE /api/v1/operation_templates/:id" do
    it "soft deletes for admin users" do
      stub_clerk_for(admin)

      delete "/api/v1/operation_templates/#{template.id}", headers: auth_headers_for(admin)

      expect(response).to have_http_status(:no_content)
      expect(template.reload.is_active).to be(false)
    end

    it "rejects non-admin users" do
      stub_clerk_for(employee)

      delete "/api/v1/operation_templates/#{template.id}", headers: auth_headers_for(employee)

      expect(response).to have_http_status(:forbidden)
      expect(JSON.parse(response.body)["error"]).to eq("Admin access required")
    end
  end
end
