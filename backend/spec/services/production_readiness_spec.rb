# frozen_string_literal: true

require "rails_helper"
require "ostruct"

RSpec.describe ProductionReadiness do
  class FakeSolidQueueAdapter; end

  let(:environment) { ActiveSupport::EnvironmentInquirer.new("production") }
  let(:encryption) do
    Struct.new(:primary_key, :deterministic_key, :key_derivation_salt).new("primary", "deterministic", "salt")
  end
  let(:config) do
    OpenStruct.new(
      force_ssl: true,
      assume_ssl: true,
      active_storage: OpenStruct.new(service: :amazon),
      active_record: OpenStruct.new(encryption: encryption)
    )
  end
  let(:env) do
    {
      "RAILS_ENV" => "production",
      "ACTIVE_JOB_QUEUE_ADAPTER" => "solid_queue",
      "SOLID_QUEUE_IN_PUMA" => "true",
      "REQUIRE_MFA" => "true",
      "FRONTEND_URL" => "https://aire.example.com",
      "CLERK_SECRET_KEY" => "sk_live_secret",
      "CLERK_JWKS_URL" => "https://clerk.example.com/.well-known/jwks.json",
      "AWS_ACCESS_KEY_ID" => "s3-access",
      "AWS_SECRET_ACCESS_KEY" => "s3-secret",
      "AWS_REGION" => "us-west-2",
      "AWS_S3_BUCKET" => "aire-private",
      "RESEND_API_KEY" => "re_secret",
      "MAILER_FROM_EMAIL" => "AIRE Services <operations@example.com>",
      "CORNERSTONE_PAYROLL_EVENTS_URL" => "https://payroll.example.com/api/v1/integrations/aire/events",
      "PAYROLL_SHARED_SECRET" => "shared-secret"
    }
  end
  let(:connection) { instance_double(ActiveRecord::ConnectionAdapters::AbstractAdapter, select_value: 1) }
  let(:record_class) { class_double(ActiveRecord::Base, connection: connection) }
  let(:queue_relation) { instance_double(ActiveRecord::Relation, exists?: true) }
  let(:queue_process) { class_double(SolidQueue::Process, where: queue_relation) }
  let(:storage) do
    Class.new do
      attr_reader :objects, :deleted

      def initialize
        @objects = {}
        @deleted = []
      end

      def upload(key, data, checksum:, content_type:)
        raise "missing checksum" if checksum.blank?
        raise "wrong content type" unless content_type == "text/plain"

        objects[key] = data.read
      end

      def download(key)
        objects[key]
      end

      def delete(key)
        deleted << key
        objects.delete(key)
      end
    end.new
  end
  let(:outbox_relation) do
    Class.new do
      def where(*)
        self
      end

      def none?
        true
      end
    end.new
  end
  let(:outbox_events) { class_double(PayrollOutboxEvent, where: outbox_relation) }
  let(:recurring_config) do
    {
      "finalize_due_payroll_cutoffs" => {
        "class" => "PayrollCutoffFinalizationJob",
        "queue" => "payroll",
        "schedule" => "every minute"
      },
      "deliver_payroll_outbox_events" => {
        "class" => "PayrollOutboxDeliveryJob",
        "queue" => "payroll",
        "schedule" => "every minute"
      }
    }
  end
  let(:http_get) do
    lambda do |uri, _token|
      case uri.host
      when "api.clerk.com"
        [ 200, { "id" => "ins_live" } ]
      when "clerk.example.com"
        [ 200, { "keys" => [ { "kid" => "key_1" } ] } ]
      when "api.resend.com"
        [ 200, { "data" => [ { "name" => "example.com", "status" => "verified", "capabilities" => { "sending" => "enabled" } } ] } ]
      when "payroll.example.com"
        [ 200, {} ]
      else
        raise "unexpected host"
      end
    end
  end

  subject(:readiness) do
    described_class.new(
      env: env,
      environment: environment,
      config: config,
      primary_record: record_class,
      queue_process: queue_process,
      job_adapter: FakeSolidQueueAdapter.new,
      storage_factory: -> { storage },
      outbox_events: outbox_events,
      recurring_config: recurring_config,
      http_get: http_get
    )
  end

  before do
    allow(ActiveRecord::Migration).to receive(:check_all_pending!).and_return(nil)
  end

  it "passes effective configuration and every safe live dependency probe" do
    report = readiness.run(live: true)

    expect(report).to be_passed
    expect(report.checks.length).to eq(23)
    expect(storage.objects).to be_empty
    expect(storage.deleted.length).to eq(1)
    expect(queue_process).to have_received(:where).with(kind: "Worker", last_heartbeat_at: instance_of(Range))
  end

  it "can run configuration-only checks outside a live release" do
    expect(http_get).not_to receive(:call)

    report = readiness.run(live: false)

    expect(report).to be_passed
    expect(report.checks.length).to eq(14)
  end

  it "fails closed for development Clerk credentials and missing MFA attestation" do
    env["CLERK_SECRET_KEY"] = "sk_test_secret"
    env.delete("REQUIRE_MFA")

    report = readiness.run(live: false)

    expect(report.failures.map(&:name)).to contain_exactly(
      "MFA enforcement is attested",
      "production Clerk credentials are configured"
    )
  end

  it "rejects a non-HTTPS frontend and an unexpected payroll destination path" do
    env["FRONTEND_URL"] = "http://aire.example.com"
    env["CORNERSTONE_PAYROLL_EVENTS_URL"] = "https://payroll.example.com/up"

    report = readiness.run(live: false)

    expect(report.failures.map(&:name)).to contain_exactly(
      "the frontend origin is an explicit production HTTPS origin",
      "the Cornerstone payroll event destination is production HTTPS"
    )
  end

  it "requires both payroll recurring jobs" do
    recurring_config.delete("deliver_payroll_outbox_events")

    report = readiness.run(live: false)

    expect(report.failures.map(&:name)).to include("the payroll cutoff and delivery schedules are configured")
  end

  it "fails when an old payroll event remains undelivered" do
    allow(outbox_relation).to receive(:none?).and_return(false)

    report = readiness.run(live: true)

    expect(report.failures.map(&:name)).to include("no payroll event has remained undelivered past the retry window")
  end

  it "does not expose provider errors or credentials in evidence" do
    secret_error = "provider rejected sk_live_do-not-print-this"
    allow(http_get).to receive(:call).and_raise(StandardError, secret_error)

    report = readiness.run(live: true)
    details = report.failures.map(&:detail).join(" ")

    expect(details).to include("StandardError while verifying")
    expect(details).not_to include(secret_error)
    expect(details).not_to include("sk_live_do-not-print-this")
  end

  it "cleans its exact S3 probe object when read-back does not match" do
    allow(storage).to receive(:download).and_return("wrong payload")

    report = readiness.run(live: true)

    expect(report.failures.map(&:name)).to include("the S3 upload/read/delete round trip succeeds")
    expect(storage.objects).to be_empty
    expect(storage.deleted.length).to eq(1)
  end

  it "attempts exact S3 cleanup when the upload result is uncertain" do
    allow(storage).to receive(:upload).and_raise(IOError, "simulated lost upload response")

    report = readiness.run(live: true)

    expect(report.failures.map(&:name)).to include("the S3 upload/read/delete round trip succeeds")
    expect(storage.deleted.length).to eq(1)
  end
end
