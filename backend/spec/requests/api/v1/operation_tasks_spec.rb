# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Api::V1::OperationTasks", type: :request do
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
      clerk_id: "spec-admin-operation-tasks-request",
      email: "admin-operation-tasks-request@example.com",
      role: "admin",
      first_name: "Spec",
      last_name: "Admin"
    )
  end

  let!(:employee) do
    User.create!(
      clerk_id: "spec-employee-operation-tasks-request",
      email: "employee-operation-tasks-request@example.com",
      role: "employee",
      first_name: "Spec",
      last_name: "Employee"
    )
  end

  let!(:client_user) do
    User.create!(
      clerk_id: "spec-client-operation-tasks-request",
      email: "client-operation-tasks-request@example.com",
      role: "client",
      first_name: "Spec",
      last_name: "Client"
    )
  end

  let!(:client) do
    Client.create!(
      first_name: "Ops",
      last_name: "Client",
      email: "ops-client-request@example.com"
    )
  end

  let!(:template) do
    OperationTemplate.create!(
      name: "Operation Tasks Request Template #{SecureRandom.hex(4)}",
      category: "general",
      recurrence_type: "monthly",
      auto_generate: true,
      created_by: admin
    )
  end

  let!(:dependency_template_task) do
    template.operation_template_tasks.create!(title: "Dependency Task", position: 1)
  end

  let!(:main_template_task) do
    template.operation_template_tasks.create!(
      title: "Main Task",
      position: 2,
      dependency_template_task_ids: [ dependency_template_task.id ]
    )
  end

  let!(:cycle) do
    OperationCycle.create!(
      client: client,
      operation_template: template,
      period_start: Date.current.beginning_of_month,
      period_end: Date.current.end_of_month,
      cycle_label: "Request Spec Cycle",
      generation_mode: "manual",
      status: "active",
      generated_by: admin
    )
  end

  let!(:dependency_task) do
    OperationTask.create!(
      operation_cycle: cycle,
      operation_template_task: dependency_template_task,
      client: client,
      title: dependency_template_task.title,
      position: 1,
      status: "not_started",
      evidence_required: false
    )
  end

  let!(:main_task) do
    OperationTask.create!(
      operation_cycle: cycle,
      operation_template_task: main_template_task,
      client: client,
      title: main_template_task.title,
      position: 2,
      status: "not_started",
      evidence_required: false
    )
  end

  let!(:assigned_task) do
    OperationTask.create!(
      operation_cycle: cycle,
      operation_template_task: dependency_template_task,
      client: client,
      title: "Assigned Task",
      position: 3,
      status: "not_started",
      assigned_to: employee,
      evidence_required: false
    )
  end

  let!(:evidence_required_task) do
    OperationTask.create!(
      operation_cycle: cycle,
      operation_template_task: dependency_template_task,
      client: client,
      title: "Evidence Required Task",
      position: 4,
      status: "not_started",
      evidence_required: true
    )
  end

  describe "GET /api/v1/operation_tasks" do
    it "returns unmet prerequisite metadata for staff" do
      stub_clerk_for(employee)

      get "/api/v1/operation_tasks", headers: auth_headers_for(employee)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      serialized_main_task = body.fetch("operation_tasks").find { |task| task["id"] == main_task.id }
      expect(serialized_main_task).not_to be_nil
      expect(serialized_main_task["unmet_prerequisites"]).to include(
        a_hash_including("id" => dependency_task.id, "title" => dependency_task.title, "status" => "not_started")
      )
    end

    it "rejects client users" do
      stub_clerk_for(client_user)

      get "/api/v1/operation_tasks", headers: auth_headers_for(client_user)

      expect(response).to have_http_status(:forbidden)
      expect(JSON.parse(response.body)["error"]).to eq("Staff access required")
    end

    it "returns pagination metadata" do
      assigned_task
      evidence_required_task
      stub_clerk_for(employee)

      get "/api/v1/operation_tasks?page=1&per_page=1&include_done=true", headers: auth_headers_for(employee)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body.fetch("meta")).to include(
        "current_page" => 1,
        "per_page" => 1
      )
      expect(body.fetch("meta").fetch("total_count")).to be >= 3
      expect(body.fetch("operation_tasks").length).to eq(1)
    end
  end

  describe "POST /api/v1/operation_tasks/:id/complete" do
    it "blocks completion when prerequisites are not done" do
      stub_clerk_for(employee)

      post "/api/v1/operation_tasks/#{main_task.id}/complete", params: {}.to_json, headers: auth_headers_for(employee)

      expect(response).to have_http_status(:unprocessable_entity)
      expect(JSON.parse(response.body)["error"]).to include("cannot be updated until prerequisites are completed")
    end

    it "requires evidence note when task requires evidence" do
      stub_clerk_for(employee)

      post "/api/v1/operation_tasks/#{evidence_required_task.id}/complete",
           params: {}.to_json,
           headers: auth_headers_for(employee)

      expect(response).to have_http_status(:unprocessable_entity)
      expect(JSON.parse(response.body)["error"].downcase).to include("evidence note is required")
    end

    it "completes task when evidence note is provided" do
      stub_clerk_for(employee)

      post "/api/v1/operation_tasks/#{evidence_required_task.id}/complete",
           params: { evidence_note: "Uploaded proof of delivery" }.to_json,
           headers: auth_headers_for(employee)

      expect(response).to have_http_status(:ok)
      payload = JSON.parse(response.body).fetch("operation_task")
      expect(payload["status"]).to eq("done")
      expect(payload["evidence_note"]).to eq("Uploaded proof of delivery")
    end
  end

  describe "GET /api/v1/operation_tasks/my_tasks" do
    it "returns only current user's assigned tasks" do
      stub_clerk_for(employee)

      get "/api/v1/operation_tasks/my_tasks", headers: auth_headers_for(employee)

      expect(response).to have_http_status(:ok)
      ids = JSON.parse(response.body).fetch("operation_tasks").map { |task| task["id"] }
      expect(ids).to include(assigned_task.id)
      expect(ids).not_to include(main_task.id)
    end
  end

  describe "PATCH /api/v1/operation_tasks/:id" do
    it "updates task status and notes for staff users" do
      stub_clerk_for(employee)

      patch "/api/v1/operation_tasks/#{assigned_task.id}",
            params: {
              operation_task: {
                status: "in_progress",
                notes: "Started processing"
              }
            }.to_json,
            headers: auth_headers_for(employee)

      expect(response).to have_http_status(:ok)
      payload = JSON.parse(response.body).fetch("operation_task")
      expect(payload["status"]).to eq("in_progress")
      expect(payload["notes"]).to eq("Started processing")
    end
  end

  describe "POST /api/v1/operation_tasks/:id/reopen" do
    it "reopens completed tasks" do
      assigned_task.update!(status: "done", completed_at: Time.current, completed_by: employee)
      stub_clerk_for(employee)

      post "/api/v1/operation_tasks/#{assigned_task.id}/reopen",
           params: {}.to_json,
           headers: auth_headers_for(employee)

      expect(response).to have_http_status(:ok)
      payload = JSON.parse(response.body).fetch("operation_task")
      expect(payload["status"]).to eq("not_started")
      expect(payload["completed_at"]).to be_nil
      expect(payload["completed_by"]).to be_nil
    end
  end
end
