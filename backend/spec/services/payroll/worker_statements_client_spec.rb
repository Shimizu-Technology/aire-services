# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::WorkerStatementsClient do
  let(:uuid) { SecureRandom.uuid }
  let(:env) do
    {
      "CORNERSTONE_PAYROLL_EVENTS_URL" => "https://payroll.example.test/api/v1/integrations/time_payroll/events",
      "PAYROLL_SHARED_SECRET" => "test-shared-secret"
    }
  end
  let(:requests) { [] }

  def response(code, body = "", content_type = "application/json")
    Struct.new(:code, :body, :headers) do
      def [](name) = headers[name]
    end.new(code.to_s, body, { "Content-Type" => content_type })
  end

  def client(reply)
    described_class.new(env: env, http: lambda { |uri, headers|
      requests << { uri: uri, headers: headers }
      reply.respond_to?(:call) ? reply.call : reply
    })
  end

  let(:list_body) { { worker: { employment_type: "hourly", contractor: false }, statements: [ { id: 41 } ] }.to_json }

  it "reads the signed-in worker's statements from the events host with the shared secret" do
    payload = client(response(200, list_body)).statements(uuid)

    expect(payload.fetch("statements")).to eq([ { "id" => 41 } ])
    request = requests.sole
    expect(request[:uri].to_s).to eq("https://payroll.example.test/api/v1/integrations/time_payroll/workers/#{uuid}/statements")
    expect(request[:headers]).to eq("Accept" => "application/json", "X-Shared-Secret" => "test-shared-secret")
  end

  it "reads a statement and its PDF by exact numeric ID" do
    detail = client(response(200, { id: 41, earnings: [] }.to_json)).statement(uuid, "41")
    expect(detail.fetch("id")).to eq(41)
    expect(requests.last[:uri].path).to end_with("/workers/#{uuid}/statements/41")

    pdf = client(response(200, "%PDF-1.7 test", "application/pdf")).statement_pdf(uuid, "41")
    expect(pdf).to start_with("%PDF-")
    expect(requests.last[:uri].path).to end_with("/statements/41/pdf")
    expect(requests.last[:headers]["Accept"]).to eq("application/pdf")
  end

  it "accepts any 2xx response and treats other non-error statuses as Unavailable" do
    expect(client(response(203, list_body)).statements(uuid).fetch("statements")).to eq([ { "id" => 41 } ])
    expect(client(response(201, { id: 41 }.to_json)).statement(uuid, "41").fetch("id")).to eq(41)
    expect(client(response(206, "%PDF-1.7 test", "application/pdf")).statement_pdf(uuid, "41")).to start_with("%PDF-")

    [ 199, 302, 304, 400, 422 ].each do |status|
      expect { client(response(status, list_body)).statements(uuid) }.to raise_error(described_class::Unavailable, /HTTP #{status}/)
      expect { client(response(status, { id: 41 }.to_json)).statement(uuid, "41") }.to raise_error(described_class::Unavailable, /HTTP #{status}/)
      expect { client(response(status, "%PDF-1.7", "application/pdf")).statement_pdf(uuid, "41") }
        .to raise_error(described_class::Unavailable, /HTTP #{status}/)
    end
  end

  it "maps an unknown or unmapped worker to NotLinked and an unknown statement to NotFound" do
    expect { client(response(404, "{}")).statements(uuid) }.to raise_error(described_class::NotLinked)
    expect { client(response(404, "{}")).statement(uuid, "41") }.to raise_error(described_class::NotFound)
    expect { client(response(404, "{}")).statement_pdf(uuid, "41") }.to raise_error(described_class::NotFound)
  end

  it "rejects malformed statement IDs and worker UUIDs without calling Cornerstone" do
    [ "../41", "41/pdf", "0", "-1", "1e3", "", "4" * 19 ].each do |id|
      expect { client(response(200, "{}")).statement(uuid, id) }.to raise_error(described_class::NotFound)
    end
    expect { client(response(200, list_body)).statements("not-a-uuid") }.to raise_error(described_class::NotLinked)
    expect(requests).to be_empty
  end

  {
    "a server error" => -> { Struct.new(:code, :body) { def [](_) = nil }.new("502", "") },
    "an auth rejection" => -> { Struct.new(:code, :body) { def [](_) = nil }.new("401", "") },
    "a timeout" => -> { raise Net::ReadTimeout },
    "a refused connection" => -> { raise Errno::ECONNREFUSED }
  }.each do |label, reply|
    it "reports #{label} as Unavailable without leaking the secret" do
      expect { client(reply).statements(uuid) }.to raise_error(described_class::Unavailable) do |error|
        expect(error.message).not_to include("test-shared-secret", "payroll.example.test")
      end
    end
  end

  it "treats unreadable or unexpected payloads as Unavailable" do
    expect { client(response(200, "<html>")).statements(uuid) }.to raise_error(described_class::Unavailable)
    expect { client(response(200, { statements: "nope" }.to_json)).statements(uuid) }.to raise_error(described_class::Unavailable)
    expect { client(response(200, "not a pdf", "application/pdf")).statement_pdf(uuid, "41") }.to raise_error(described_class::Unavailable)
    expect { client(response(200, "%PDF-1.7", "text/html")).statement_pdf(uuid, "41") }.to raise_error(described_class::Unavailable)
  end

  it "is Unavailable when the Cornerstone destination or secret is not configured" do
    env.delete("PAYROLL_SHARED_SECRET")
    expect { client(response(200, list_body)).statements(uuid) }.to raise_error(described_class::Unavailable, /PAYROLL_SHARED_SECRET/)
    env["PAYROLL_SHARED_SECRET"] = "test-shared-secret"
    env.delete("CORNERSTONE_PAYROLL_EVENTS_URL")
    expect { client(response(200, list_body)).statements(uuid) }.to raise_error(described_class::Unavailable, /CORNERSTONE_PAYROLL_EVENTS_URL/)
    expect(requests).to be_empty
  end

  it "applies staging integration containment to the statements host" do
    env.merge!("DEPLOYMENT_ENV" => "staging", "STAGING_INTEGRATION_HOSTS" => "other.example.test")
    expect { client(response(200, list_body)).statements(uuid) }.to raise_error(described_class::Unavailable)
    expect(requests).to be_empty
  end
end
