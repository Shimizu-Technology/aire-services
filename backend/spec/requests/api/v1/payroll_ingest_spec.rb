# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Api::V1::PayrollIngest", type: :request do
  let(:shared_secret) { "test-payroll-secret-#{SecureRandom.hex(8)}" }
  let(:secret_headers) do
    {
      "X-Shared-Secret" => shared_secret,
      "Content-Type" => "application/json"
    }
  end

  let(:valid_payload) do
    {
      payroll_import: {
        idempotency_key: "idem-#{SecureRandom.hex(8)}",
        source_payroll_run_id: "run-123",
        total_gross: 9000.00,
        total_net: 6900.00,
        total_tax: 2100.00,
        employee_count: 2,
        payload: {
          employees: [
            { name: "Alice", gross_pay: 5000.00, net_pay: 3800.00, tax_withheld: 1200.00 },
            { name: "Bob", gross_pay: 4000.00, net_pay: 3100.00, tax_withheld: 900.00 }
          ]
        }
      }
    }
  end

  before do
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:[]).with("PAYROLL_SHARED_SECRET").and_return(shared_secret)
  end

  describe "POST /api/v1/payroll/ingest" do
    context "authentication" do
      it "rejects requests without X-Shared-Secret header" do
        post "/api/v1/payroll/ingest",
          params: valid_payload.to_json,
          headers: { "Content-Type" => "application/json" }

        expect(response).to have_http_status(:unauthorized)
        expect(JSON.parse(response.body)["error"]).to eq("Missing X-Shared-Secret header")
      end

      it "rejects requests with wrong secret" do
        post "/api/v1/payroll/ingest",
          params: valid_payload.to_json,
          headers: { "X-Shared-Secret" => "wrong-secret", "Content-Type" => "application/json" }

        expect(response).to have_http_status(:unauthorized)
        expect(JSON.parse(response.body)["error"]).to eq("Invalid shared secret")
      end

      it "returns 503 when PAYROLL_SHARED_SECRET is not configured" do
        allow(ENV).to receive(:[]).with("PAYROLL_SHARED_SECRET").and_return(nil)

        post "/api/v1/payroll/ingest",
          params: valid_payload.to_json,
          headers: secret_headers

        expect(response).to have_http_status(:service_unavailable)
      end
    end

    context "with valid authentication" do
      it "accepts flat CPR payload shape" do
        flat_payload = {
          idempotency_key: "idem-flat-#{SecureRandom.hex(6)}",
          source: "cornerstone-payroll",
          pay_period: { id: 555, start_date: Date.current.beginning_of_month.iso8601, end_date: Date.current.end_of_month.iso8601, pay_date: Date.current.iso8601 },
          company: { id: 1, name: "Local Co" },
          totals: { employee_count: 1, gross_pay: 1200.0, net_pay: 1000.0, total_tax_liability: 283.6 },
          line_items: [
            { gross_pay: 1200.0, net_pay: 1000.0, withholding_tax: 100.0, social_security_tax: 74.4, medicare_tax: 17.4, employer_social_security_tax: 74.4, employer_medicare_tax: 17.4 }
          ]
        }

        post "/api/v1/payroll/ingest", params: flat_payload.to_json, headers: secret_headers

        expect(response).to have_http_status(:created)
        body = JSON.parse(response.body)
        expect(body.dig("payroll_import_batch", "status")).to eq("reconciled")
      end

      it "creates a new batch with reconciled status" do
        post "/api/v1/payroll/ingest",
          params: valid_payload.to_json,
          headers: secret_headers

        expect(response).to have_http_status(:created)

        body = JSON.parse(response.body)
        batch = body["payroll_import_batch"]
        expect(batch["status"]).to eq("reconciled")
        expect(batch["idempotency_key"]).to eq(valid_payload[:payroll_import][:idempotency_key])
        expect(body["replayed"]).to be false
      end

      it "returns existing batch on duplicate idempotency_key" do
        post "/api/v1/payroll/ingest",
          params: valid_payload.to_json,
          headers: secret_headers
        expect(response).to have_http_status(:created)

        first_id = JSON.parse(response.body)["payroll_import_batch"]["id"]

        # Second request with same idempotency_key
        post "/api/v1/payroll/ingest",
          params: valid_payload.to_json,
          headers: secret_headers
        expect(response).to have_http_status(:ok)

        body = JSON.parse(response.body)
        expect(body["payroll_import_batch"]["id"]).to eq(first_id)
        expect(body["replayed"]).to be true
      end

      it "does not create a duplicate record for replayed requests" do
        post "/api/v1/payroll/ingest",
          params: valid_payload.to_json,
          headers: secret_headers

        expect {
          post "/api/v1/payroll/ingest",
            params: valid_payload.to_json,
            headers: secret_headers
        }.not_to change(PayrollImportBatch, :count)
      end
    end

    context "validation" do
      it "rejects missing idempotency_key" do
        payload = valid_payload.deep_dup
        payload[:payroll_import].delete(:idempotency_key)

        post "/api/v1/payroll/ingest",
          params: payload.to_json,
          headers: secret_headers

        expect(response).to have_http_status(:unprocessable_entity)
      end

      it "rejects missing source_payroll_run_id" do
        payload = valid_payload.deep_dup
        payload[:payroll_import].delete(:source_payroll_run_id)

        post "/api/v1/payroll/ingest",
          params: payload.to_json,
          headers: secret_headers

        expect(response).to have_http_status(:unprocessable_entity)
      end
    end

    context "reconciliation" do
      it "sets status to failed when totals mismatch" do
        payload = valid_payload.deep_dup
        payload[:payroll_import][:total_gross] = 99999.00

        post "/api/v1/payroll/ingest",
          params: payload.to_json,
          headers: secret_headers

        expect(response).to have_http_status(:created)
        batch = JSON.parse(response.body)["payroll_import_batch"]
        expect(batch["status"]).to eq("failed")
        expect(batch["error_message"]).to eq("Reconciliation mismatch")
      end

      it "tolerates rounding within one cent" do
        payload = valid_payload.deep_dup
        payload[:payroll_import][:total_gross] = 9000.01

        post "/api/v1/payroll/ingest",
          params: payload.to_json,
          headers: secret_headers

        expect(response).to have_http_status(:created)
        batch = JSON.parse(response.body)["payroll_import_batch"]
        expect(batch["status"]).to eq("reconciled")
      end

      it "reconciles when no totals are provided" do
        payload = valid_payload.deep_dup
        payload[:payroll_import].delete(:total_gross)
        payload[:payroll_import].delete(:total_net)
        payload[:payroll_import].delete(:total_tax)
        payload[:payroll_import].delete(:employee_count)

        post "/api/v1/payroll/ingest",
          params: payload.to_json,
          headers: secret_headers

        expect(response).to have_http_status(:created)
        batch = JSON.parse(response.body)["payroll_import_batch"]
        expect(batch["status"]).to eq("reconciled")
      end
    end
  end
end
