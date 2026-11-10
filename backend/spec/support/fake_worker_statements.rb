# frozen_string_literal: true

require "prawn"

# A stand-in for Cornerstone's worker statements API. Rows carry amounts, an
# SSN and bank numbers on purpose, so specs can prove none of them leak.
RSpec.shared_context "fake worker statements" do
  let(:cornerstone_env) do
    {
      "CORNERSTONE_PAYROLL_EVENTS_URL" => "https://payroll.example.test/api/v1/integrations/time_payroll/events",
      "PAYROLL_SHARED_SECRET" => "test-shared-secret"
    }
  end
  let(:cornerstone_requests) { [] }
  let(:cornerstone_down) { false }
  # payroll_integration_uuid => [statement rows]
  let(:statement_rows) { {} }
  let(:sent_mail) { [] }

  before do
    Payroll::MyPayStatements.clear_ownership_cache!
    allow(Payroll::WorkerStatementsClient).to receive(:new).and_wrap_original do |original, **|
      original.call(env: cornerstone_env, http: method(:fake_cornerstone))
    end
    allow(StagingMailTransport).to receive(:deliver) do |payload, **|
      sent_mail << payload
      { "id" => "email-#{sent_mail.size}" }
    end
  end

  def statement_row(id, pay_date:, status: "issued", period_start: nil, period_end: nil)
    date = Date.iso8601(pay_date)
    {
      id: id,
      pay_period: { start_date: (period_start || (date - 20)).to_s, end_date: (period_end || (date - 6)).to_s, pay_date: pay_date, run_purpose: "regular" },
      check_date: pay_date,
      gross_pay: "1234.56",
      net_pay: "987.65",
      total_hours: "80.00",
      payment: { method: "direct_deposit", status: status, issued_on: pay_date, check_number_last4: "4321" },
      has_source_entries: false,
      ssn: "123-45-6789",
      bank_account_number: "000123456789",
      routing_number: "021000021"
    }
  end

  def stub_statements(user, *rows)
    statement_rows[user.payroll_integration_uuid] = rows
  end

  def statement_pdf(id)
    Prawn::Document.new { |pdf| pdf.text("Earnings statement #{id}") }.render
  end

  def fake_cornerstone(uri, headers)
    cornerstone_requests << uri.path
    raise Net::OpenTimeout if cornerstone_down
    raise "missing shared secret" unless headers["X-Shared-Secret"] == "test-shared-secret"

    match = uri.path.match(%r{\A/api/v1/integrations/time_payroll/workers/([^/]+)/statements(?:/(\d+))?(/pdf)?\z})
    rows = match && statement_rows[match[1]]
    return cornerstone_reply(404, "{}") unless rows
    return cornerstone_reply(200, { worker: { employment_type: "hourly", contractor: false }, statements: rows }.to_json) unless match[2]

    row = rows.find { |candidate| candidate[:id].to_s == match[2] }
    return cornerstone_reply(404, "{}") unless row
    return cornerstone_reply(200, statement_pdf(row[:id]), "application/pdf") if match[3]

    cornerstone_reply(200, row.to_json)
  end

  def cornerstone_reply(code, body, content_type = "application/json")
    Struct.new(:code, :body, :content_type) do
      def [](name) = name == "Content-Type" ? content_type : nil
    end.new(code.to_s, body, content_type)
  end

  # Every string in a response or email that would reveal pay or identity data.
  def forbidden_values
    [ "1234.56", "987.65", "80.00", "123-45-6789", "000123456789", "021000021", "gross", "net_pay", "ssn", "bank" ]
  end

  def expect_no_pay_details(text)
    forbidden_values.each { |value| expect(text.to_s).not_to include(value) }
  end
end
