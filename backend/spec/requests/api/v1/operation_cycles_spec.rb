# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Api::V1::OperationCycles", type: :request do
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
      clerk_id: "spec-admin-operation-cycles-request",
      email: "admin-operation-cycles-request@example.com",
      role: "admin",
      first_name: "Spec",
      last_name: "Admin"
    )
  end

  let!(:employee) do
    User.create!(
      clerk_id: "spec-employee-operation-cycles-request",
      email: "employee-operation-cycles-request@example.com",
      role: "employee",
      first_name: "Spec",
      last_name: "Employee"
    )
  end

  let!(:client_user) do
    User.create!(
      clerk_id: "spec-client-operation-cycles-request",
      email: "client-operation-cycles-request@example.com",
      role: "client",
      first_name: "Spec",
      last_name: "Client"
    )
  end

  let!(:client) do
    Client.create!(
      first_name: "Cycles",
      last_name: "Client",
      email: "cycles-client-request@example.com"
    )
  end

  let!(:template) do
    OperationTemplate.create!(
      name: "Operation Cycles Request Template #{SecureRandom.hex(4)}",
      category: "general",
      recurrence_type: "monthly",
      auto_generate: true,
      created_by: admin
    )
  end

  let!(:template_task) do
    template.operation_template_tasks.create!(title: "Task", position: 1)
  end

  let!(:assignment) do
    ClientOperationAssignment.create!(
      client: client,
      operation_template: template,
      auto_generate: true,
      assignment_status: "active",
      starts_on: Date.current.beginning_of_month,
      created_by: admin
    )
  end

  describe "GET /api/v1/clients/:client_id/operation_cycles" do
    it "allows staff access" do
      cycle = GenerateOperationCycleService.new(
        client: client,
        operation_template: template,
        period_start: Date.current.beginning_of_month,
        period_end: Date.current.end_of_month,
        generation_mode: "manual",
        generated_by: admin
      ).call.cycle
      expect(cycle).to be_present

      stub_clerk_for(employee)
      get "/api/v1/clients/#{client.id}/operation_cycles", headers: auth_headers_for(employee)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body.fetch("operation_cycles").map { |item| item["id"] }).to include(cycle.id)
    end

    it "rejects client users" do
      stub_clerk_for(client_user)

      get "/api/v1/clients/#{client.id}/operation_cycles", headers: auth_headers_for(client_user)

      expect(response).to have_http_status(:forbidden)
      expect(JSON.parse(response.body)["error"]).to eq("Staff access required")
    end

    it "returns paginated cycles with metadata" do
      GenerateOperationCycleService.new(
        client: client,
        operation_template: template,
        assignment: assignment,
        period_start: Date.current.beginning_of_month,
        period_end: Date.current.end_of_month,
        generation_mode: "manual",
        generated_by: admin
      ).call
      GenerateOperationCycleService.new(
        client: client,
        operation_template: template,
        assignment: assignment,
        period_start: Date.current.beginning_of_month - 1.month,
        period_end: Date.current.end_of_month - 1.month,
        generation_mode: "manual",
        generated_by: admin
      ).call

      stub_clerk_for(employee)
      get "/api/v1/clients/#{client.id}/operation_cycles?page=1&per_page=1", headers: auth_headers_for(employee)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body.fetch("operation_cycles").length).to eq(1)
      expect(body.fetch("meta")).to include(
        "current_page" => 1,
        "per_page" => 1
      )
      expect(body.fetch("meta").fetch("total_count")).to be >= 2
    end
  end

  describe "POST /api/v1/clients/:client_id/operation_cycles/generate" do
    it "creates cycle for admin users" do
      stub_clerk_for(admin)

      post "/api/v1/clients/#{client.id}/operation_cycles/generate",
           params: {
             client_operation_assignment_id: assignment.id,
             period_start: Date.current.beginning_of_month,
             period_end: Date.current.end_of_month
           }.to_json,
           headers: auth_headers_for(admin)

      expect(response).to have_http_status(:created)
      payload = JSON.parse(response.body).fetch("operation_cycle")
      expect(payload["tasks"].length).to eq(1)
      expect(payload["client_operation_assignment_id"]).to eq(assignment.id)
    end

    it "rejects non-admin users" do
      stub_clerk_for(employee)

      post "/api/v1/clients/#{client.id}/operation_cycles/generate",
           params: {
             operation_template_id: template.id,
             period_start: Date.current.beginning_of_month,
             period_end: Date.current.end_of_month
           }.to_json,
           headers: auth_headers_for(employee)

      expect(response).to have_http_status(:forbidden)
      expect(JSON.parse(response.body)["error"]).to eq("Admin access required")
    end
  end

  describe "GET /api/v1/operation_cycles/:id" do
    it "allows staff and returns nested tasks" do
      cycle = GenerateOperationCycleService.new(
        client: client,
        operation_template: template,
        assignment: assignment,
        period_start: Date.current.beginning_of_month,
        period_end: Date.current.end_of_month,
        generation_mode: "manual",
        generated_by: admin
      ).call.cycle
      expect(cycle).to be_present

      stub_clerk_for(employee)
      get "/api/v1/operation_cycles/#{cycle.id}", headers: auth_headers_for(employee)

      expect(response).to have_http_status(:ok)
      payload = JSON.parse(response.body).fetch("operation_cycle")
      expect(payload["tasks"].length).to eq(1)
    end

    it "rejects client users" do
      cycle = GenerateOperationCycleService.new(
        client: client,
        operation_template: template,
        assignment: assignment,
        period_start: Date.current.beginning_of_month + 1.day,
        period_end: Date.current.end_of_month,
        generation_mode: "manual",
        generated_by: admin
      ).call.cycle
      expect(cycle).to be_present

      stub_clerk_for(client_user)
      get "/api/v1/operation_cycles/#{cycle.id}", headers: auth_headers_for(client_user)

      expect(response).to have_http_status(:forbidden)
      expect(JSON.parse(response.body)["error"]).to eq("Staff access required")
    end
  end
end
