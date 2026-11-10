# frozen_string_literal: true

require "rails_helper"

RSpec.describe "My Pay", type: :request do
  let(:worker) { create(:user, :employee) }
  let(:other_worker) { create(:user, :employee) }
  let(:admin) { create(:user, :admin) }
  let(:category) { create(:time_category, name: "Flight instruction") }
  let(:headers) { { "Authorization" => "Bearer test_token_#{worker.id}" } }
  let(:cornerstone_env) do
    {
      "CORNERSTONE_PAYROLL_EVENTS_URL" => "https://payroll.example.test/api/v1/integrations/time_payroll/events",
      "PAYROLL_SHARED_SECRET" => "test-shared-secret"
    }
  end
  let(:cornerstone_requests) { [] }
  let(:cornerstone_down) { false }
  let(:own_entry) { create(:time_entry, user: worker, time_category: category, work_date: Date.new(2026, 10, 20), status: "completed", approval_status: "approved") }
  let(:carried_entry) { create(:time_entry, user: worker, time_category: category, work_date: Date.new(2026, 10, 14), status: "completed", approval_status: "approved") }
  let(:foreign_entry) { create(:time_entry, user: other_worker, time_category: category, work_date: Date.new(2026, 10, 21), status: "completed", approval_status: "approved") }
  let(:workers) do
    {
      worker.payroll_integration_uuid => { employment_type: "hourly", contractor: false, display_name: "Test Worker", ids: [ 42, 41 ] },
      other_worker.payroll_integration_uuid => { employment_type: "hourly", contractor: false, display_name: "Other Worker", ids: [ 99 ] }
    }
  end

  def summary(id)
    {
      id: id,
      pay_period: { start_date: "2026-10-16", end_date: "2026-10-31", pay_date: id == 42 ? "2026-11-15" : "2026-10-31", run_purpose: "regular" },
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
        { label: "Regular", hours: "76.00", rate: "18.50", amount: "1406.00", ytd: "22990.00", kind: "regular" },
        { label: "Overtime", hours: "4.00", rate: "27.75", amount: "111.00", ytd: "1200.00", kind: "overtime" },
        { label: "Regular Pay", hours: nil, rate: nil, amount: "0.00", ytd: "500.00", kind: "other" }
      ],
      taxes: [ { label: "Federal income tax", amount: "120.00", ytd: "2400.00" } ],
      deductions: [ { label: "Retirement", amount: "25.00", ytd: "500.00" } ],
      other_pay: [ { label: "Mileage reimbursement", amount: "40.00", ytd: "120.00" } ],
      ytd: { gross: "24690.00", net: "19753.00" },
      bank_account_number: "000123456789",
      routing_number: "021000021",
      employee_ssn: "123-45-6789",
      source_entries: [
        { source_time_entry_id: own_entry.id.to_s, work_date: "2026-10-20", hours: "8.00", regular_hours: "6.00", overtime_hours: "2.00", source_kind: "current", category: "flight" },
        { source_time_entry_id: carried_entry.id.to_s, work_date: "2026-10-14", hours: "4.00", regular_hours: "4.00", overtime_hours: "0.00", source_kind: "carryover", category: "flight" },
        { source_time_entry_id: foreign_entry.id.to_s, work_date: "2026-10-21", hours: "1.00", regular_hours: "1.00", overtime_hours: "0.00", source_kind: "current", category: "flight" }
      ]
    )
  end

  # A deliberately permissive Cornerstone double: its detail and PDF routes
  # answer for any known statement ID regardless of worker, so these specs prove
  # AIRE's own ownership check rather than relying on Cornerstone's scoping.
  def fake_cornerstone(uri, headers)
    cornerstone_requests << uri.path
    raise Net::OpenTimeout if cornerstone_down
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

  before do
    Payroll::MyPayStatements.clear_ownership_cache!
    allow(Payroll::WorkerStatementsClient).to receive(:new).and_wrap_original do |original, **|
      original.call(env: cornerstone_env, http: method(:fake_cornerstone))
    end
    Setting.set("my_pay_enabled_user_ids", "#{worker.id},#{other_worker.id}")
  end

  describe "access" do
    it "requires sign-in" do
      get "/api/v1/my_pay"
      expect(response).to have_http_status(:unauthorized)
      expect(cornerstone_requests).to be_empty
    end

    it "is hidden for users outside the pilot allowlist" do
      Setting.set("my_pay_enabled_user_ids", other_worker.id.to_s)
      get "/api/v1/my_pay", headers: headers
      expect(response).to have_http_status(:forbidden)
      expect(response.parsed_body).to include("code" => "my_pay_not_enabled")
      get "/api/v1/auth/me", headers: headers
      expect(response.parsed_body.dig("user", "my_pay_enabled")).to be(false)
      expect(cornerstone_requests).to be_empty
    end

    it "is hidden by default when no pilot Setting exists" do
      Setting.where(key: "my_pay_enabled_user_ids").delete_all
      get "/api/v1/my_pay", headers: headers
      expect(response).to have_http_status(:forbidden)
    end

    it "opens to every active staff member with the enable-for-everyone switch" do
      Setting.set("my_pay_enabled_user_ids", "")
      Setting.set("my_pay_enabled_for_all", "true")
      get "/api/v1/auth/me", headers: headers
      expect(response.parsed_body.dig("user", "my_pay_enabled")).to be(true)
      get "/api/v1/my_pay", headers: headers
      expect(response).to have_http_status(:ok)

      worker.update!(is_active: false)
      get "/api/v1/my_pay", headers: headers
      expect(response).not_to have_http_status(:ok)
    end

    it "lets an allowlisted admin see only their own pay" do
      workers[admin.payroll_integration_uuid] = { employment_type: "salary", contractor: false, display_name: "Admin", ids: [ 7 ] }
      Setting.set("my_pay_enabled_user_ids", admin.id.to_s)
      get "/api/v1/my_pay", headers: { "Authorization" => "Bearer test_token_#{admin.id}" }
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body.fetch("statements").map { |row| row["id"] }).to eq([ "7" ])
      expect(cornerstone_requests).to eq([ "/api/v1/integrations/time_payroll/workers/#{admin.payroll_integration_uuid}/statements" ])
    end

    it "ignores any worker identifier supplied by the client" do
      get "/api/v1/my_pay", params: { source_user_uuid: other_worker.payroll_integration_uuid, user_id: other_worker.id }, headers: headers
      expect(response.parsed_body.fetch("statements").map { |row| row["id"] }).to eq(%w[42 41])
      expect(cornerstone_requests).to all(include(worker.payroll_integration_uuid))
    end
  end

  describe "GET /api/v1/my_pay" do
    it "lists the worker's statements newest first through an allowlist and audits the view" do
      get "/api/v1/my_pay", headers: headers

      expect(response).to have_http_status(:ok)
      expect(response.headers["Cache-Control"]).to eq("no-store")
      body = response.parsed_body
      expect(body.fetch("worker")).to eq("employment_type" => "hourly", "contractor" => false)
      expect(body.fetch("statements").first).to eq(
        "id" => "42", "pay_date" => "2026-11-15", "check_date" => "2026-11-15",
        "period_start" => "2026-10-16", "period_end" => "2026-10-31", "run_purpose" => "regular",
        "gross_pay" => "1234.56", "net_pay" => "987.65", "total_hours" => "80.00",
        "payment" => { "method" => "paper_check", "status" => "issued", "issued_on" => "2026-11-15", "check_number_last4" => "4321" },
        "has_source_entries" => true
      )
      expect(response.body).not_to include("123-45-6789", "ssn", "display_name")

      audit = AuditLog.find_by!(action: "my_pay.statements_viewed")
      expect(audit).to have_attributes(user_id: worker.id, auditable_id: worker.id, event_category: "payroll", outcome: "succeeded")
      expect(audit.metadata).to eq("statement_count" => 2)
    end

    it "still shows pay when the audit write fails, and reports the failure as an error" do
      failure = ActiveRecord::StatementInvalid.new("audit table unavailable")
      allow(AuditLog).to receive(:record!).and_raise(failure)
      allow(Rails.error).to receive(:report)
      allow(Rails.logger).to receive(:error)

      get "/api/v1/my_pay", headers: headers

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body.fetch("statements").size).to eq(2)
      expect(Rails.logger).to have_received(:error).with("[MyPay] Failed to audit my_pay.statements_viewed: ActiveRecord::StatementInvalid")
      expect(Rails.error).to have_received(:report).with(failure, handled: true, severity: :error,
        context: { operation: "my_pay_audit", action: "my_pay.statements_viewed", outcome: "succeeded" })
    end

    it "returns a friendly unavailable state when Cornerstone is down" do
      allow(self).to receive(:cornerstone_down).and_return(true)
      get "/api/v1/my_pay", headers: headers
      expect(response).to have_http_status(:service_unavailable)
      expect(response.parsed_body).to eq("error" => "Pay history is temporarily unavailable. Please try again in a few minutes.", "code" => "my_pay_unavailable")
      expect(AuditLog.find_by!(action: "my_pay.statements_viewed").outcome).to eq("failed")
    end

    it "explains when the worker has no payroll link" do
      workers.delete(worker.payroll_integration_uuid)
      get "/api/v1/my_pay", headers: headers
      expect(response).to have_http_status(:not_found)
      expect(response.parsed_body).to include("code" => "payroll_not_linked")
      expect(response.parsed_body["error"]).to include("isn't connected to payroll")
    end
  end

  describe "GET /api/v1/my_pay/:id" do
    it "returns the full breakdown enriched with the worker's own AIRE entries" do
      get "/api/v1/my_pay/42", headers: headers

      expect(response).to have_http_status(:ok)
      statement = response.parsed_body.fetch("statement")
      expect(statement).to include("id" => "42", "net_pay" => "987.65", "ytd" => { "gross" => "24690.00", "net" => "19753.00" })
      expect(statement.fetch("earnings")).to eq([
        { "label" => "Regular", "hours" => "76.00", "rate" => "18.50", "amount" => "1406.00", "ytd" => "22990.00", "kind" => "regular" },
        { "label" => "Overtime", "hours" => "4.00", "rate" => "27.75", "amount" => "111.00", "ytd" => "1200.00", "kind" => "overtime" },
        # Paid earlier this year, not on this check: the stub's $0.00 row with its YTD.
        { "label" => "Regular Pay", "hours" => nil, "rate" => nil, "amount" => "0.00", "ytd" => "500.00", "kind" => "other" }
      ])
      expect(statement.fetch("taxes")).to eq([ { "label" => "Federal income tax", "amount" => "120.00", "ytd" => "2400.00" } ])
      expect(statement.fetch("deductions")).to eq([ { "label" => "Retirement", "amount" => "25.00", "ytd" => "500.00" } ])
      expect(statement.fetch("other_pay")).to eq([ { "label" => "Mileage reimbursement", "amount" => "40.00", "ytd" => "120.00" } ])
      expect(statement.fetch("hours_on_check")).to eq([
        { "time_entry_id" => carried_entry.id, "work_date" => "2026-10-14", "category" => "Flight instruction",
          "total_hours" => "4.00", "regular_hours" => "4.00", "overtime_hours" => "0.00", "source_kind" => "carryover", "prior_period" => true },
        { "time_entry_id" => own_entry.id, "work_date" => "2026-10-20", "category" => "Flight instruction",
          "total_hours" => "8.00", "regular_hours" => "6.00", "overtime_hours" => "2.00", "source_kind" => "current", "prior_period" => false },
        # Never linked to another worker's AIRE entry, even if Cornerstone lists it.
        { "time_entry_id" => nil, "work_date" => "2026-10-21", "category" => "flight",
          "total_hours" => "1.00", "regular_hours" => "1.00", "overtime_hours" => "0.00", "source_kind" => "current", "prior_period" => false }
      ])
      expect(response.body).not_to include("000123456789", "021000021", "123-45-6789", "routing", "bank_account")
      expect(AuditLog.find_by!(action: "my_pay.statement_viewed").metadata).to eq("statement_id" => "42")
    end

    it "uses contractor wording: no taxes and no overtime language" do
      workers[worker.payroll_integration_uuid].merge!(employment_type: "contractor", contractor: true)
      get "/api/v1/my_pay/42", headers: headers

      body = response.parsed_body
      expect(body.fetch("worker")).to eq("employment_type" => "contractor", "contractor" => true)
      statement = body.fetch("statement")
      expect(statement.fetch("taxes")).to eq([])
      expect(statement.fetch("earnings").map { |line| line.values_at("label", "kind", "note") })
        .to eq([ [ "Regular", "regular", nil ], [ "Regular Pay", "other", nil ], [ "Contract hours", "regular", "Paid at 1.5× your contract rate" ] ])
      expect(statement.fetch("hours_on_check").map(&:keys)).to all(eq(%w[time_entry_id work_date category total_hours source_kind prior_period]))
      expect(statement.fetch("hours_on_check").map { |line| line["total_hours"] }).to eq(%w[4.00 8.00 1.00])
      expect(statement.to_json).not_to match(/overtime|\bOT\b/i)
    end

    it "folds an older straight-time contractor OT row into its matching row, as payroll prints it now" do
      workers[worker.payroll_integration_uuid].merge!(employment_type: "contractor", contractor: true)
      allow(self).to receive(:detail).and_wrap_original do |original, id|
        original.call(id).merge(
          gross_pay: "2274.00", net_pay: "2274.00", taxes: [], deductions: [], other_pay: [],
          earnings: [
            { label: "Flight Hours · AIRE current period · $30.00/hr", hours: "60.60", rate: "30.00", amount: "1818.00", ytd: "3018.00", kind: "regular" },
            { label: "Flight Hours · AIRE current period · $30.00/hr OT", hours: "1.20", rate: "30.00", amount: "36.00", ytd: "36.00", kind: "overtime" },
            { label: "Ground Instruction Hours · AIRE current period · $30.00/hr", hours: "14.00", rate: "30.00", amount: "420.00", ytd: nil, kind: "regular" }
          ]
        )
      end
      get "/api/v1/my_pay/42", headers: headers

      earnings = response.parsed_body.dig("statement", "earnings")
      expect(earnings).to eq([
        { "label" => "Flight Hours · AIRE current period · $30.00/hr", "hours" => "61.80", "rate" => "30.00", "amount" => "1854.00", "ytd" => "3054.00",
          "kind" => "regular" },
        { "label" => "Ground Instruction Hours · AIRE current period · $30.00/hr", "hours" => "14.00", "rate" => "30.00", "amount" => "420.00", "ytd" => nil,
          "kind" => "regular" }
      ])
      expect(earnings.sum { |line| BigDecimal(line["amount"]) }).to eq(BigDecimal("2274.00"))
    end

    it "adds a contractor's earlier-this-year OT rows to the contract row's YTD, with no OT wording" do
      workers[worker.payroll_integration_uuid].merge!(employment_type: "contractor", contractor: true)
      allow(self).to receive(:detail).and_wrap_original do |original, id|
        original.call(id).merge(
          gross_pay: "1854.00", net_pay: "1854.00", taxes: [], deductions: [], other_pay: [], ytd: { gross: "4389.00", net: "4389.00" },
          # As Cornerstone's stub prints it before contractor OT folding: YTD-only rows for the earlier split.
          earnings: [
            { label: "Flight Hours · AIRE current period · $30.00/hr", hours: "61.80", rate: "30.00", amount: "1854.00", ytd: "3054.00", kind: "regular" },
            { label: "Contract Labor", hours: nil, rate: nil, amount: "0.00", ytd: "1200.00", kind: "regular" },
            { label: "Contract OT", hours: nil, rate: nil, amount: "0.00", ytd: "90.00", kind: "overtime" },
            { label: "Ground Hours OT", hours: nil, rate: nil, amount: "0.00", ytd: "45.00", kind: "overtime" }
          ]
        )
      end
      get "/api/v1/my_pay/42", headers: headers

      earnings = response.parsed_body.dig("statement", "earnings")
      expect(earnings.map { |line| line.values_at("label", "amount", "ytd", "kind") }).to eq([
        [ "Flight Hours · AIRE current period · $30.00/hr", "1854.00", "3054.00", "regular" ],
        [ "Contract Labor", "0.00", "1290.00", "regular" ],
        [ "Ground Hours", "0.00", "45.00", "regular" ]
      ])
      expect(earnings.sum { |line| BigDecimal(line["ytd"]) }).to eq(BigDecimal("4389.00"))
      expect(earnings.to_json).not_to match(/overtime|\bOT\b/i)
    end

    it "keeps work-date notes on their own line in earning labels" do
      allow(self).to receive(:detail).and_wrap_original do |original, id|
        original.call(id).merge(earnings: [
          { label: "Prior-period hours worked Sep 15, 2026\r\n  Admin Duties  \n\n", hours: "4.25", rate: "10.00", amount: "42.50", kind: "regular" }
        ])
      end
      get "/api/v1/my_pay/42", headers: headers

      expect(response.parsed_body.dig("statement", "earnings", 0, "label")).to eq("Prior-period hours worked Sep 15, 2026\nAdmin Duties")
    end

    it "returns 404 for a statement that belongs to another worker, even if Cornerstone would answer" do
      get "/api/v1/my_pay/99", headers: headers

      expect(response).to have_http_status(:not_found)
      expect(response.parsed_body).to include("code" => "statement_not_found")
      expect(cornerstone_requests.grep(%r{/statements/99})).to be_empty
      expect(AuditLog.find_by!(action: "my_pay.statement_viewed")).to have_attributes(outcome: "denied")
    end

    it "returns 404 for malformed IDs without calling Cornerstone" do
      [ "41abc", "0", "-41", "41.0" ].each do |id|
        get "/api/v1/my_pay/#{id}", headers: headers
        expect(response).to have_http_status(:not_found)
      end
      expect(cornerstone_requests).to be_empty
    end

    it "caches only ownership briefly and refreshes it for a newly committed statement" do
      get "/api/v1/my_pay", headers: headers
      get "/api/v1/my_pay/42", headers: headers
      get "/api/v1/my_pay/41", headers: headers
      expect(cornerstone_requests.count { |path| path.end_with?("/statements") }).to eq(1)

      workers[worker.payroll_integration_uuid][:ids].unshift(43)
      get "/api/v1/my_pay/43", headers: headers
      expect(response).to have_http_status(:ok)
      expect(cornerstone_requests.count { |path| path.end_with?("/statements") }).to eq(2)
      cached = Payroll::MyPayStatements::OWNERSHIP_CACHE.read("my_pay/ownership/#{worker.id}/#{worker.payroll_integration_uuid}")
      expect(cached.to_json).not_to include("1234.56", "987.65")
    end

    it "returns a friendly unavailable state when Cornerstone is down" do
      allow(self).to receive(:cornerstone_down).and_return(true)
      get "/api/v1/my_pay/42", headers: headers
      expect(response).to have_http_status(:service_unavailable)
      expect(response.parsed_body).to include("code" => "my_pay_unavailable")
    end
  end

  describe "GET /api/v1/my_pay/:id/pdf" do
    it "returns the official stub as a download" do
      get "/api/v1/my_pay/42/pdf", headers: headers

      expect(response).to have_http_status(:ok)
      expect(response.media_type).to eq("application/pdf")
      expect(response.headers["Content-Disposition"]).to include("attachment", "AIRE-pay-statement-2026-11-15.pdf")
      expect(response.headers["Cache-Control"]).to eq("no-store")
      expect(response.body).to eq("%PDF-1.7 statement 42")
      expect(AuditLog.find_by!(action: "my_pay.statement_pdf_downloaded").metadata).to eq("statement_id" => "42")
    end

    it "refuses another worker's PDF" do
      get "/api/v1/my_pay/99/pdf", headers: headers
      expect(response).to have_http_status(:not_found)
      expect(response.media_type).to eq("application/json")
      expect(cornerstone_requests.grep(%r{/pdf})).to be_empty
    end
  end
end
