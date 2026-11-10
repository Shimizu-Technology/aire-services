# frozen_string_literal: true

require "rails_helper"

RSpec.describe "My Pay preview", type: :request do
  let(:viewer) { create(:user, :admin, first_name: "Leon", last_name: "Viewer") }
  let(:other_admin) { create(:user, :admin, first_name: "Roke", last_name: "Admin") }
  let(:worker) { create(:user, :employee, first_name: "Ana", last_name: "Worker") }
  let(:other_worker) { create(:user, :employee, first_name: "Ben", last_name: "Other") }
  let(:unmapped_worker) { create(:user, :employee, first_name: "Cora", last_name: "Unmapped") }
  let(:category) { create(:time_category, name: "Flight instruction") }
  let(:viewer_headers) { { "Authorization" => "Bearer test_token_#{viewer.id}" } }
  let(:cornerstone_env) do
    {
      "CORNERSTONE_PAYROLL_EVENTS_URL" => "https://payroll.example.test/api/v1/integrations/time_payroll/events",
      "PAYROLL_SHARED_SECRET" => "test-shared-secret"
    }
  end
  let(:cornerstone_requests) { [] }
  let(:own_entry) { create(:time_entry, user: worker, time_category: category, work_date: Date.new(2026, 10, 20), status: "completed", approval_status: "approved") }
  let(:foreign_entry) { create(:time_entry, user: other_worker, time_category: category, work_date: Date.new(2026, 10, 21), status: "completed", approval_status: "approved") }
  let(:workers) do
    {
      worker.payroll_integration_uuid => { employment_type: "contractor", contractor: true, ids: [ 42, 41 ] },
      other_worker.payroll_integration_uuid => { employment_type: "hourly", contractor: false, ids: [ 99 ] }
    }
  end

  def summary(id)
    {
      id: id,
      pay_period: { start_date: "2026-10-16", end_date: "2026-10-31", pay_date: "2026-11-15", run_purpose: "regular" },
      check_date: "2026-11-15",
      gross_pay: "1234.56",
      net_pay: "987.65",
      total_hours: "80.00",
      payment: { method: "paper_check", status: "issued", issued_on: "2026-11-15", check_number_last4: "4321" },
      has_source_entries: true,
      ssn: "123-45-6789"
    }
  end

  def detail(id)
    summary(id).merge(
      earnings: [
        { label: "Contract Labor", hours: "76.00", rate: "18.50", amount: "1406.00", ytd: "22990.00", kind: "regular" },
        { label: "Contract Labor OT", hours: "4.00", rate: "18.50", amount: "74.00", ytd: "500.00", kind: "overtime" }
      ],
      taxes: [ { label: "Federal income tax", amount: "120.00", ytd: "2400.00" } ],
      deductions: [],
      ytd: { gross: "24690.00", net: "19753.00" },
      bank_account_number: "000123456789",
      source_entries: [
        { source_time_entry_id: own_entry.id.to_s, work_date: "2026-10-20", hours: "8.00", regular_hours: "6.00", overtime_hours: "2.00", source_kind: "current" },
        { source_time_entry_id: foreign_entry.id.to_s, work_date: "2026-10-21", hours: "1.00", regular_hours: "1.00", overtime_hours: "0.00", source_kind: "current" }
      ]
    )
  end

  # Permissive like the My Pay double: detail and PDF answer for any known ID,
  # so these specs prove AIRE's own ownership check for the previewed worker.
  def fake_cornerstone(uri, headers)
    cornerstone_requests << uri.path
    raise "missing shared secret" unless headers["X-Shared-Secret"] == "test-shared-secret"

    match = uri.path.match(%r{\A/api/v1/integrations/time_payroll/workers/([^/]+)/statements(?:/(\d+))?(/pdf)?\z})
    known = workers[match && match[1]]
    return reply(404, "{}") unless match && known

    return reply(200, { worker: known.except(:ids), statements: known[:ids].map { |id| summary(id) } }.to_json) unless match[2]

    id = match[2].to_i
    return reply(404, "{}") unless workers.values.flat_map { |row| row[:ids] }.include?(id)
    return reply(200, "%PDF-1.7 statement #{id}", "application/pdf") if match[3]

    reply(200, detail(id).to_json)
  end

  def reply(code, body, content_type = "application/json")
    Struct.new(:code, :body, :content_type) do
      def [](name) = name == "Content-Type" ? content_type : nil
    end.new(code.to_s, body, content_type)
  end

  def preview_path(user_id, suffix = "")
    "/api/v1/my_pay/preview/workers/#{user_id}/statements#{suffix}"
  end

  before do
    Payroll::MyPayStatements.clear_ownership_cache!
    allow(Payroll::WorkerStatementsClient).to receive(:new).and_wrap_original do |original, **|
      original.call(env: cornerstone_env, http: method(:fake_cornerstone))
    end
    # My Pay itself stays off for every worker throughout.
    Setting.set("my_pay_enabled_user_ids", "")
    Setting.set("my_pay_enabled_for_all", "false")
    Setting.set("my_pay_preview_user_ids", viewer.id.to_s)
  end

  describe "access" do
    it "requires sign-in" do
      get preview_path(worker.id)
      expect(response).to have_http_status(:unauthorized)
      expect(cornerstone_requests).to be_empty
    end

    it "refuses an admin who isn't on the preview allowlist, with no worker data" do
      [ "/api/v1/my_pay/preview/workers", "/api/v1/my_pay/preview/workers/#{worker.id}", preview_path(worker.id), preview_path(worker.id, "/42"), preview_path(worker.id, "/42/pdf") ].each do |path|
        get path, headers: { "Authorization" => "Bearer test_token_#{other_admin.id}" }
        expect(response).to have_http_status(:forbidden)
        expect(response.parsed_body).to eq("error" => "My Pay preview isn't available for your account.", "code" => "my_pay_preview_not_enabled")
      end
      expect(cornerstone_requests).to be_empty
      expect(AuditLog.where(action: "authorization.my_pay_preview_denied", user: other_admin).count).to eq(5)

      get "/api/v1/auth/me", headers: { "Authorization" => "Bearer test_token_#{other_admin.id}" }
      expect(response.parsed_body.dig("user", "my_pay_preview_enabled")).to be(false)
    end

    it "refuses an employee even if their ID is put on the allowlist" do
      Setting.set("my_pay_preview_user_ids", "#{viewer.id},#{worker.id}")
      get preview_path(other_worker.id), headers: { "Authorization" => "Bearer test_token_#{worker.id}" }
      expect(response).to have_http_status(:forbidden)
      get "/api/v1/my_pay/preview/workers", headers: { "Authorization" => "Bearer test_token_#{worker.id}" }
      expect(response).to have_http_status(:forbidden)
      expect(cornerstone_requests).to be_empty
    end

    it "is off for everyone when no preview Setting exists" do
      Setting.where(key: "my_pay_preview_user_ids").delete_all
      get preview_path(worker.id), headers: viewer_headers
      expect(response).to have_http_status(:forbidden)
    end

    it "tells the frontend who may preview" do
      get "/api/v1/auth/me", headers: viewer_headers
      expect(response.parsed_body.dig("user", "my_pay_preview_enabled")).to be(true)
      expect(response.parsed_body.dig("user", "my_pay_enabled")).to be(false)
    end

    it "returns 404 for an unknown, inactive or malformed target without calling Cornerstone" do
      inactive = create(:user, :employee, is_active: false)
      [ "0", "999999999", inactive.id.to_s, "abc" ].each do |id|
        get preview_path(id), headers: viewer_headers
        expect(response).to have_http_status(:not_found)
        expect(response.parsed_body).to include("code" => "worker_not_found")
      end
      expect(cornerstone_requests).to be_empty
    end
  end

  describe "GET /api/v1/my_pay/preview/workers" do
    it "lists active staff by name with whether their hours have reached payroll" do
      batch = create(:payroll_batch)
      batch.payroll_batch_entries.create!(source_time_entry_id: own_entry.id, source_user_id: worker.id,
        source_user_uuid: worker.payroll_integration_uuid, source_category_id: category.id,
        work_date: own_entry.work_date, week_start: own_entry.work_date.beginning_of_week(:sunday), source_kind: "current",
        line_key: "work", total_hours: 8, regular_hours: 8, overtime_hours: 0, snapshot: {})
      create(:user, :employee, first_name: "Zed", is_active: false)
      [ other_worker, unmapped_worker ].each(&:touch)

      get "/api/v1/my_pay/preview/workers", headers: viewer_headers

      expect(response).to have_http_status(:ok)
      expect(response.headers["Cache-Control"]).to eq("no-store")
      rows = response.parsed_body.fetch("workers")
      expect(rows.map { |row| row["name"] }).to eq([ "Ana Worker", "Ben Other", "Cora Unmapped", "Leon Viewer" ])
      expect(rows.first).to eq("id" => worker.id, "name" => "Ana Worker", "role" => "employee", "sent_to_payroll" => true)
      expect(rows.second["sent_to_payroll"]).to be(false)
      expect(cornerstone_requests).to be_empty
    end
  end

  describe "GET /api/v1/my_pay/preview/workers/:user_id/statements" do
    it "returns exactly what the worker's own My Pay would, even while My Pay is off for workers" do
      get preview_path(worker.id), headers: viewer_headers

      expect(response).to have_http_status(:ok)
      expect(response.headers["Cache-Control"]).to eq("no-store")
      body = response.parsed_body
      expect(body["worker"]).to eq("employment_type" => "contractor", "contractor" => true)
      expect(body["statements"].map { |row| row["id"] }).to eq(%w[42 41])
      expect(body.to_json).not_to include("123-45-6789")
      expect(body).to eq(Payroll::MyPayPresenter.new(user: worker).list(JSON.parse({ worker: workers[worker.payroll_integration_uuid].except(:ids), statements: [ summary(42), summary(41) ] }.to_json)).as_json)
      expect(cornerstone_requests).to eq([ "/api/v1/integrations/time_payroll/workers/#{worker.payroll_integration_uuid}/statements" ])

      get "/api/v1/my_pay", headers: { "Authorization" => "Bearer test_token_#{worker.id}" }
      expect(response).to have_http_status(:forbidden)
    end

    it "audits the viewer and the previewed worker without amounts" do
      get preview_path(worker.id), headers: viewer_headers

      audit = AuditLog.find_by!(action: "my_pay.preview_statements_viewed")
      expect(audit).to have_attributes(user_id: viewer.id, auditable_type: "User", auditable_id: worker.id, outcome: "succeeded", event_category: "payroll")
      expect(audit.metadata).to eq("viewer_user_id" => viewer.id, "target_user_id" => worker.id, "read_only" => true, "statement_count" => 2)
      expect(audit.attributes.to_json).not_to include("987.65", "1234.56")
    end

    it "fails closed when the audit row can't be written" do
      allow(AuditLog).to receive(:record!).and_raise(ActiveRecord::StatementInvalid, "audit table unavailable")
      allow(Rails.error).to receive(:report)

      get preview_path(worker.id), headers: viewer_headers

      expect(response).to have_http_status(:service_unavailable)
      expect(response.body).not_to include("987.65")
      expect(Rails.error).to have_received(:report).with(an_instance_of(ActiveRecord::StatementInvalid), hash_including(handled: true))
    end

    it "shows the same not-connected message My Pay gives for a worker without a payroll link" do
      get preview_path(unmapped_worker.id), headers: viewer_headers

      expect(response).to have_http_status(:not_found)
      expect(response.parsed_body).to eq("error" => Api::V1::MyPayController::NOT_LINKED_MESSAGE, "code" => "payroll_not_linked")
      expect(AuditLog.find_by!(action: "my_pay.preview_statements_viewed")).to have_attributes(outcome: "failed", auditable_id: unmapped_worker.id)
    end
  end

  describe "GET /api/v1/my_pay/preview/workers/:user_id/statements/:id" do
    it "returns the worker's full breakdown with contractor wording and only their own entries linked" do
      get preview_path(worker.id, "/42"), headers: viewer_headers

      expect(response).to have_http_status(:ok)
      statement = response.parsed_body.fetch("statement")
      expect(statement["taxes"]).to eq([])
      # The contractor's straight-time OT row folds into the contract row, as in My Pay.
      expect(statement["earnings"]).to contain_exactly(hash_including("label" => "Contract Labor", "hours" => "80.00", "amount" => "1480.00"))
      expect(statement["hours_on_check"].map { |row| row["time_entry_id"] }).to contain_exactly(own_entry.id, nil)
      expect(response.body).not_to include("000123456789", "123-45-6789")

      audit = AuditLog.find_by!(action: "my_pay.preview_statement_viewed")
      expect(audit).to have_attributes(user_id: viewer.id, auditable_id: worker.id)
      expect(audit.metadata).to eq("viewer_user_id" => viewer.id, "target_user_id" => worker.id, "read_only" => true, "statement_id" => "42")
    end

    it "returns 404 for a statement that isn't in the target worker's own list" do
      get preview_path(worker.id, "/99"), headers: viewer_headers

      expect(response).to have_http_status(:not_found)
      expect(response.parsed_body).to include("code" => "statement_not_found")
      expect(response.body).not_to include("987.65")
      expect(cornerstone_requests).not_to include(a_string_ending_with("/statements/99"))
      expect(AuditLog.find_by!(action: "my_pay.preview_statement_viewed")).to have_attributes(outcome: "denied", auditable_id: worker.id)
    end

    it "returns 404 for a malformed statement ID" do
      get preview_path(worker.id, "/42abc"), headers: viewer_headers
      expect(response).to have_http_status(:not_found)
    end
  end

  describe "GET /api/v1/my_pay/preview/workers/:user_id/statements/:id/pdf" do
    it "returns the worker's stub and audits the download" do
      get preview_path(worker.id, "/42/pdf"), headers: viewer_headers

      expect(response).to have_http_status(:ok)
      expect(response.media_type).to eq("application/pdf")
      expect(response.headers["Content-Disposition"]).to include("AIRE-pay-statement-2026-11-15.pdf")
      expect(AuditLog.find_by!(action: "my_pay.preview_statement_pdf_downloaded").metadata).to include("statement_id" => "42", "target_user_id" => worker.id)
    end

    it "refuses another worker's PDF" do
      get preview_path(worker.id, "/99/pdf"), headers: viewer_headers
      expect(response).to have_http_status(:not_found)
      expect(cornerstone_requests).not_to include(a_string_ending_with("/99/pdf"))
    end
  end

  describe "GET /api/v1/my_pay/preview/workers/:user_id" do
    it "returns the worker's name for the preview banner" do
      get "/api/v1/my_pay/preview/workers/#{worker.id}", headers: viewer_headers
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to eq("worker" => { "id" => worker.id, "name" => "Ana Worker", "role" => "employee", "sent_to_payroll" => false })
    end
  end
end
