# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Api::V1::Admin::PayrollImportBatches", type: :request do
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
      clerk_id: "spec-admin-payroll-batches",
      email: "admin-payroll-batches@example.com",
      role: "admin",
      first_name: "Spec",
      last_name: "Admin"
    )
  end

  let!(:employee) do
    User.create!(
      clerk_id: "spec-employee-payroll-batches",
      email: "employee-payroll-batches@example.com",
      role: "employee",
      first_name: "Spec",
      last_name: "Employee"
    )
  end

  let!(:batch_reconciled) { create(:payroll_import_batch, :reconciled) }
  let!(:batch_failed) { create(:payroll_import_batch, :failed) }

  describe "GET /api/v1/admin/payroll_import_batches" do
    it "returns all batches for admin users" do
      stub_clerk_for(admin)

      get "/api/v1/admin/payroll_import_batches", headers: auth_headers_for(admin)

      expect(response).to have_http_status(:ok)
      batches = JSON.parse(response.body)["payroll_import_batches"]
      expect(batches.length).to eq(2)
    end

    it "filters by status" do
      stub_clerk_for(admin)

      get "/api/v1/admin/payroll_import_batches",
        params: { status: "reconciled" },
        headers: auth_headers_for(admin)

      expect(response).to have_http_status(:ok)
      batches = JSON.parse(response.body)["payroll_import_batches"]
      expect(batches.length).to eq(1)
      expect(batches.first["status"]).to eq("reconciled")
    end

    it "rejects non-admin users" do
      stub_clerk_for(employee)

      get "/api/v1/admin/payroll_import_batches", headers: auth_headers_for(employee)

      expect(response).to have_http_status(:forbidden)
    end

    it "rejects unauthenticated requests" do
      get "/api/v1/admin/payroll_import_batches"

      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "GET /api/v1/admin/payroll_import_batches/:id" do
    it "returns batch detail with payload for admin" do
      stub_clerk_for(admin)

      get "/api/v1/admin/payroll_import_batches/#{batch_reconciled.id}",
        headers: auth_headers_for(admin)

      expect(response).to have_http_status(:ok)
      batch = JSON.parse(response.body)["payroll_import_batch"]
      expect(batch["id"]).to eq(batch_reconciled.id)
      expect(batch).to have_key("payload")
    end

    it "returns 404 for non-existent batch" do
      stub_clerk_for(admin)

      get "/api/v1/admin/payroll_import_batches/0",
        headers: auth_headers_for(admin)

      expect(response).to have_http_status(:not_found)
    end

    it "rejects non-admin users" do
      stub_clerk_for(employee)

      get "/api/v1/admin/payroll_import_batches/#{batch_reconciled.id}",
        headers: auth_headers_for(employee)

      expect(response).to have_http_status(:forbidden)
    end
  end
end
