# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Api::V1::OperationTemplateTasks", type: :request do
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
      clerk_id: "spec-admin-operation-template-tasks-request",
      email: "admin-operation-template-tasks-request@example.com",
      role: "admin",
      first_name: "Spec",
      last_name: "Admin"
    )
  end

  let!(:employee) do
    User.create!(
      clerk_id: "spec-employee-operation-template-tasks-request",
      email: "employee-operation-template-tasks-request@example.com",
      role: "employee",
      first_name: "Spec",
      last_name: "Employee"
    )
  end

  let!(:template) do
    OperationTemplate.create!(
      name: "Template Tasks Request Spec #{SecureRandom.hex(4)}",
      category: "general",
      recurrence_type: "monthly",
      auto_generate: true,
      created_by: admin
    )
  end

  let!(:first_task) do
    template.operation_template_tasks.create!(title: "First Task", position: 1)
  end

  let!(:second_task) do
    template.operation_template_tasks.create!(title: "Second Task", position: 2)
  end

  describe "GET /api/v1/operation_templates/:operation_template_id/tasks" do
    it "returns tasks for admin users" do
      stub_clerk_for(admin)

      get "/api/v1/operation_templates/#{template.id}/tasks", headers: auth_headers_for(admin)

      expect(response).to have_http_status(:ok)
      ids = JSON.parse(response.body).fetch("tasks").map { |task| task["id"] }
      expect(ids).to include(first_task.id, second_task.id)
    end
  end

  describe "POST /api/v1/operation_templates/:operation_template_id/tasks" do
    it "creates a task with dependency ids for admin" do
      stub_clerk_for(admin)

      post "/api/v1/operation_templates/#{template.id}/tasks",
           params: {
             task: {
               title: "Dependent Task",
               position: 2,
               dependency_template_task_ids: [ first_task.id ]
             }
           }.to_json,
           headers: auth_headers_for(admin)

      expect(response).to have_http_status(:created)
      body = JSON.parse(response.body)
      expect(body.dig("task", "dependency_template_task_ids")).to eq([ first_task.id ])
    end

    it "rejects non-admin users" do
      stub_clerk_for(employee)

      post "/api/v1/operation_templates/#{template.id}/tasks",
           params: { task: { title: "Unauthorized Task" } }.to_json,
           headers: auth_headers_for(employee)

      expect(response).to have_http_status(:forbidden)
      expect(JSON.parse(response.body)["error"]).to eq("Admin access required")
    end
  end

  describe "PATCH /api/v1/operation_template_tasks/:id" do
    it "updates dependency ids for admin" do
      stub_clerk_for(admin)

      patch "/api/v1/operation_template_tasks/#{second_task.id}",
            params: {
              task: { dependency_template_task_ids: [ first_task.id ] }
            }.to_json,
            headers: auth_headers_for(admin)

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body).dig("task", "dependency_template_task_ids")).to eq([ first_task.id ])
    end

    it "rejects non-admin users" do
      stub_clerk_for(employee)

      patch "/api/v1/operation_template_tasks/#{second_task.id}",
            params: { task: { title: "Unauthorized update" } }.to_json,
            headers: auth_headers_for(employee)

      expect(response).to have_http_status(:forbidden)
      expect(JSON.parse(response.body)["error"]).to eq("Admin access required")
    end
  end

  describe "POST /api/v1/operation_templates/:operation_template_id/tasks/reorder" do
    it "reorders tasks for admin users" do
      stub_clerk_for(admin)

      post "/api/v1/operation_templates/#{template.id}/tasks/reorder",
           params: {
             positions: [
               { id: second_task.id, position: 1 },
               { id: first_task.id, position: 2 }
             ]
           }.to_json,
           headers: auth_headers_for(admin)

      expect(response).to have_http_status(:ok)
      expect(first_task.reload.position).to eq(2)
      expect(second_task.reload.position).to eq(1)
      ids = JSON.parse(response.body).fetch("tasks").map { |task| task["id"] }
      expect(ids.first(2)).to eq([ second_task.id, first_task.id ])
    end

    it "rejects non-admin users" do
      stub_clerk_for(employee)

      post "/api/v1/operation_templates/#{template.id}/tasks/reorder",
           params: {
             positions: [
               { id: second_task.id, position: 1 },
               { id: first_task.id, position: 2 }
             ]
           }.to_json,
           headers: auth_headers_for(employee)

      expect(response).to have_http_status(:forbidden)
      expect(JSON.parse(response.body)["error"]).to eq("Admin access required")
    end
  end

  describe "DELETE /api/v1/operation_template_tasks/:id" do
    it "soft deletes task for admin users" do
      stub_clerk_for(admin)

      delete "/api/v1/operation_template_tasks/#{second_task.id}", headers: auth_headers_for(admin)

      expect(response).to have_http_status(:no_content)
      expect(second_task.reload.is_active).to be(false)
    end

    it "rejects non-admin users" do
      stub_clerk_for(employee)

      delete "/api/v1/operation_template_tasks/#{second_task.id}", headers: auth_headers_for(employee)

      expect(response).to have_http_status(:forbidden)
      expect(JSON.parse(response.body)["error"]).to eq("Admin access required")
    end
  end
end
