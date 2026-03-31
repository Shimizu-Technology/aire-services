# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Api::V1::PayrollChecklists", type: :request do
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
      clerk_id: "spec-admin-payroll-checklists",
      email: "admin-payroll-checklists@example.com",
      role: "admin",
      first_name: "Spec",
      last_name: "Admin"
    )
  end

  let!(:employee) do
    User.create!(
      clerk_id: "spec-employee-payroll-checklists",
      email: "employee-payroll-checklists@example.com",
      role: "employee",
      first_name: "Spec",
      last_name: "Employee"
    )
  end

  let!(:client) do
    Client.create!(
      first_name: "Checklist",
      last_name: "Client",
      email: "checklist-client@example.com"
    )
  end

  let!(:template) { PayrollChecklistTemplateService.ensure_default_template!(created_by: admin) }
  let!(:assignment) do
    ClientOperationAssignment.create!(
      client: client,
      operation_template: template,
      auto_generate: false,
      assignment_status: "active",
      created_by: admin
    )
  end

  describe "GET /api/v1/payroll_checklists/board" do
    it "returns board periods and rows for staff" do
      stub_clerk_for(employee)
      get "/api/v1/payroll_checklists/board?start=#{Date.current.beginning_of_month}&end=#{Date.current.end_of_month}",
          headers: auth_headers_for(employee)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["periods"]).to be_present
      expect(body["rows"].map { |row| row["client_id"] }).to include(client.id)
    end

    it "does not auto-create periods on board load" do
      assignment.update!(auto_generate: true, cadence_anchor: Date.current.beginning_of_month)
      stub_clerk_for(admin)

      expect {
        get "/api/v1/payroll_checklists/board?start=#{Date.current.beginning_of_month}&end=#{Date.current.beginning_of_month + 13.days}",
            headers: auth_headers_for(admin)
      }.not_to change(OperationCycle, :count)
    end

    it "includes clients assigned to non-default payroll templates" do
      assignment.destroy!
      alt_template = OperationTemplate.create!(
        name: "Biweekly Payroll Processing",
        category: "payroll",
        recurrence_type: "biweekly",
        auto_generate: false,
        is_active: true,
        created_by: admin
      )
      OperationTemplateTask.create!(
        operation_template: alt_template,
        title: "Collect timesheets",
        position: 1,
        is_active: true
      )
      OperationTemplateTask.create!(
        operation_template: alt_template,
        title: "Run payroll",
        position: 2,
        is_active: true
      )
      ClientOperationAssignment.create!(
        client: client,
        operation_template: alt_template,
        auto_generate: false,
        assignment_status: "active",
        created_by: admin
      )

      stub_clerk_for(employee)
      get "/api/v1/payroll_checklists/board?start=#{Date.current.beginning_of_month}&end=#{Date.current.end_of_month}",
          headers: auth_headers_for(employee)

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      row = body["rows"].find { |entry| entry["client_id"] == client.id }
      expect(row).to be_present
      expect(row["cells"].first["total_count"]).to eq(2)
    end
  end

  describe "period and item lifecycle" do
    it "creates a period, updates items, and completes period" do
      stub_clerk_for(admin)
      start_date = Date.current.beginning_of_month
      end_date = start_date + 13.days

      post "/api/v1/payroll_checklists/periods",
           params: {
             client_id: client.id,
             start: start_date.iso8601,
             end: end_date.iso8601,
             pay_date: (end_date + 7.days).iso8601
           }.to_json,
           headers: auth_headers_for(admin)

      expect(response).to have_http_status(:created)
      period_id = JSON.parse(response.body).dig("period", "id")
      expect(period_id).to be_present

      get "/api/v1/payroll_checklists/periods/#{period_id}", headers: auth_headers_for(admin)
      expect(response).to have_http_status(:ok)
      detail = JSON.parse(response.body)
      expect(detail.dig("period", "status")).to eq("open")
      expect(detail["items"]).to be_present

      item_id = detail["items"].first["id"]
      patch "/api/v1/payroll_checklists/items/#{item_id}",
            params: { note: "Received by email", proof_url: "https://example.com/proof.jpg" }.to_json,
            headers: auth_headers_for(admin)
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body).dig("item", "proof_url")).to eq("https://example.com/proof.jpg")

      patch "/api/v1/payroll_checklists/items/#{item_id}/toggle",
            params: { done: true }.to_json,
            headers: auth_headers_for(admin)
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body).dig("item", "done")).to eq(true)

      post "/api/v1/payroll_checklists/periods/#{period_id}/complete",
           headers: auth_headers_for(admin)
      expect(response).to have_http_status(:unprocessable_entity)

      detail["items"].each do |item|
        patch "/api/v1/payroll_checklists/items/#{item["id"]}/toggle",
              params: { done: true }.to_json,
              headers: auth_headers_for(admin)
      end

      post "/api/v1/payroll_checklists/periods/#{period_id}/complete",
           headers: auth_headers_for(admin)
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body).dig("period", "status")).to eq("completed")
    end

    it "allows only admin to reopen a completed period" do
      stub_clerk_for(admin)
      start_date = Date.current.beginning_of_month
      end_date = start_date + 13.days
      period = GenerateOperationCycleService.new(
        client: client,
        operation_template: template,
        assignment: assignment,
        period_start: start_date,
        period_end: end_date,
        generation_mode: "manual",
        generated_by: admin
      ).call.cycle
      period.update!(status: "completed")

      stub_clerk_for(employee)
      post "/api/v1/payroll_checklists/periods/#{period.id}/reopen", headers: auth_headers_for(employee)
      expect(response).to have_http_status(:forbidden)

      stub_clerk_for(admin)
      post "/api/v1/payroll_checklists/periods/#{period.id}/reopen", headers: auth_headers_for(admin)
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body).dig("period", "status")).to eq("open")
    end

    it "allows staff users to toggle unassigned checklist items" do
      period = GenerateOperationCycleService.new(
        client: client,
        operation_template: template,
        assignment: assignment,
        period_start: Date.current.beginning_of_month,
        period_end: Date.current.beginning_of_month + 13.days,
        generation_mode: "manual",
        generated_by: admin
      ).call.cycle
      item = period.operation_tasks.first
      item.update!(assigned_to_id: nil, status: "not_started")

      stub_clerk_for(employee)
      patch "/api/v1/payroll_checklists/items/#{item.id}/toggle",
            params: { done: true }.to_json,
            headers: auth_headers_for(employee)

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body).dig("item", "done")).to eq(true)
    end
  end
end
