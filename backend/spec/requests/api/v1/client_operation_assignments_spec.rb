# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Api::V1::ClientOperationAssignments", type: :request do
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
      clerk_id: "spec-admin-client-operation-assignments-request",
      email: "admin-client-operation-assignments-request@example.com",
      role: "admin",
      first_name: "Spec",
      last_name: "Admin"
    )
  end

  let!(:employee) do
    User.create!(
      clerk_id: "spec-employee-client-operation-assignments-request",
      email: "employee-client-operation-assignments-request@example.com",
      role: "employee",
      first_name: "Spec",
      last_name: "Employee"
    )
  end

  let!(:client) do
    Client.create!(
      first_name: "Assignments",
      last_name: "Client",
      email: "assignments-client-request@example.com"
    )
  end

  let!(:template) do
    OperationTemplate.create!(
      name: "Assignments Template #{SecureRandom.hex(4)}",
      category: "general",
      recurrence_type: "monthly",
      auto_generate: true,
      created_by: admin
    )
  end

  let!(:template_task_a) do
    template.operation_template_tasks.create!(
      title: "Step A",
      position: 1
    )
  end

  let!(:template_task_b) do
    template.operation_template_tasks.create!(
      title: "Step B",
      position: 2
    )
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

  describe "GET /api/v1/clients/:client_id/operation_assignments" do
    it "returns assignments for admin" do
      stub_clerk_for(admin)

      get "/api/v1/clients/#{client.id}/operation_assignments", headers: auth_headers_for(admin)

      expect(response).to have_http_status(:ok)
      ids = JSON.parse(response.body).fetch("assignments").map { |item| item["id"] }
      expect(ids).to include(assignment.id)
    end

    it "rejects non-admin users" do
      stub_clerk_for(employee)

      get "/api/v1/clients/#{client.id}/operation_assignments", headers: auth_headers_for(employee)

      expect(response).to have_http_status(:forbidden)
      expect(JSON.parse(response.body)["error"]).to eq("Admin access required")
    end
  end

  describe "POST /api/v1/clients/:client_id/operation_assignments" do
    it "creates assignment for admin" do
      create_template = OperationTemplate.create!(
        name: "Assignments Create Template #{SecureRandom.hex(4)}",
        category: "general",
        recurrence_type: "monthly",
        auto_generate: true,
        created_by: admin
      )
      stub_clerk_for(admin)

      post "/api/v1/clients/#{client.id}/operation_assignments",
           params: {
             assignment: {
               operation_template_id: create_template.id,
               assignment_status: "active",
              starts_on: Date.current.to_s,
              excluded_template_task_ids: []
             }
           }.to_json,
           headers: auth_headers_for(admin)

      expect(response).to have_http_status(:created)
      body = JSON.parse(response.body)
      expect(body.dig("assignment", "operation_template_id")).to eq(create_template.id)
    end

    it "rejects non-admin users" do
      stub_clerk_for(employee)

      post "/api/v1/clients/#{client.id}/operation_assignments",
           params: {
             assignment: { operation_template_id: template.id }
           }.to_json,
           headers: auth_headers_for(employee)

      expect(response).to have_http_status(:forbidden)
      expect(JSON.parse(response.body)["error"]).to eq("Admin access required")
    end
  end

  describe "PATCH /api/v1/client_operation_assignments/:id" do
    it "updates assignment for admin users" do
      stub_clerk_for(admin)

      patch "/api/v1/client_operation_assignments/#{assignment.id}",
            params: { assignment: { assignment_status: "paused" } }.to_json,
            headers: auth_headers_for(admin)

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body).dig("assignment", "assignment_status")).to eq("paused")
    end

    it "validates date range on update" do
      stub_clerk_for(admin)

      patch "/api/v1/client_operation_assignments/#{assignment.id}",
            params: {
              assignment: {
                starts_on: Date.current.to_s,
                ends_on: (Date.current - 1.day).to_s
              }
            }.to_json,
            headers: auth_headers_for(admin)

      expect(response).to have_http_status(:unprocessable_entity)
      expect(JSON.parse(response.body)["error"]).to include("must be on or after start date")
    end

    it "updates excluded template task ids for admin users" do
      stub_clerk_for(admin)

      patch "/api/v1/client_operation_assignments/#{assignment.id}",
            params: { assignment: { excluded_template_task_ids: [ template_task_b.id ] } }.to_json,
            headers: auth_headers_for(admin)

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body).dig("assignment", "excluded_template_task_ids")).to eq([ template_task_b.id ])
      expect(assignment.reload.excluded_template_task_ids).to eq([ template_task_b.id ])
    end

    it "rejects excluded task ids that do not belong to assignment template" do
      other_template = OperationTemplate.create!(
        name: "Assignments Other Template #{SecureRandom.hex(4)}",
        category: "general",
        recurrence_type: "monthly",
        auto_generate: true,
        created_by: admin
      )
      other_task = other_template.operation_template_tasks.create!(title: "Other Step", position: 1)
      stub_clerk_for(admin)

      patch "/api/v1/client_operation_assignments/#{assignment.id}",
            params: { assignment: { excluded_template_task_ids: [ other_task.id ] } }.to_json,
            headers: auth_headers_for(admin)

      expect(response).to have_http_status(:unprocessable_entity)
      expect(JSON.parse(response.body)["error"]).to include("invalid template tasks")
    end

    it "rejects non-admin users" do
      stub_clerk_for(employee)

      patch "/api/v1/client_operation_assignments/#{assignment.id}",
            params: { assignment: { assignment_status: "paused" } }.to_json,
            headers: auth_headers_for(employee)

      expect(response).to have_http_status(:forbidden)
      expect(JSON.parse(response.body)["error"]).to eq("Admin access required")
    end
  end
end
