# frozen_string_literal: true

require "rails_helper"

# An employee's delete checks that payroll hasn't locked the entry. Payroll
# finalization and protecting exports run in other transactions, so the delete
# takes locks that conflict with theirs before it checks. Real connections,
# no transactional fixtures.
RSpec.describe "Employee delete vs payroll locks", type: :request do
  self.use_transactional_tests = false

  let(:zone) { ActiveSupport::TimeZone["Pacific/Guam"] }
  let!(:employee) do
    create(:user, :employee, email: "delete-contention-#{SecureRandom.hex(6)}@example.test",
                             clerk_id: "delete_contention_#{SecureRandom.hex(6)}")
  end
  let!(:category) { create(:time_category, key: "delete_contention_#{SecureRandom.hex(4)}") }
  let!(:entry) do
    create(:time_entry, user: employee, time_category: category, work_date: Date.new(2026, 9, 10),
                        entry_method: "manual", approval_status: "pending")
  end
  let(:batch_public_id) { "AIRE-PAY-CONTENTION-#{SecureRandom.hex(4)}" }
  let(:export_public_id) { "AIRE-EXPORT-CONTENTION-#{SecureRandom.hex(4)}" }

  after do
    AuditLog.transaction do
      connection = AuditLog.connection
      connection.execute("ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only")
      AuditLog.where(auditable_type: "TimeEntry", auditable_id: entry.id).delete_all
      connection.execute("ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only")
    end
    TimeEntry.where(id: entry.id).delete_all
    ReportExport.where(public_id: export_public_id).or(ReportExport.where("entry_ids @> ?", [ entry.id ].to_json)).delete_all
    PayrollBatch.transaction do
      connection = PayrollBatch.connection
      connection.execute("ALTER TABLE payroll_batches DISABLE TRIGGER payroll_batches_append_only")
      PayrollBatch.where(public_id: batch_public_id).delete_all
      connection.execute("ALTER TABLE payroll_batches ENABLE TRIGGER payroll_batches_append_only")
    end
    UserTimeCategory.where(user_id: employee.id).delete_all
    User.where(id: employee.id).destroy_all
    category.destroy! unless category.time_entries.exists?
  end

  def independent_database_connection
    config = ActiveRecord::Base.connection_db_config.configuration_hash
    PG.connect(host: config[:host], port: config[:port], user: config[:username], password: config[:password],
               dbname: config.fetch(:database))
  end

  # The delete request on its own thread and database connection.
  def delete_in_background
    Thread.new do
      session = ActionDispatch::Integration::Session.new(Rails.application)
      session.host! "localhost"
      session.delete "/api/v1/time_entries/#{entry.id}", headers: { "Authorization" => "Bearer test_token_#{employee.id}" }
      [ session.response.status, JSON.parse(session.response.body.presence || "{}") ]
    ensure
      ActiveRecord::Base.connection_pool.release_connection
    end
  end

  def wait_until_blocked(locker)
    50.times do
      waiting = locker.exec("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'")
      return if waiting.getvalue(0, 0).to_i.positive?

      sleep 0.05
    end
    raise "the delete never waited on the payroll lock"
  end

  it "refuses the delete when payroll finalizes the period while the request is in flight" do
    locker = independent_database_connection
    locker.exec("BEGIN")
    # What Payroll::BatchFinalizer#lock_source_ledger! takes before writing its batch.
    locker.exec("LOCK TABLE time_entries IN SHARE MODE")
    request = delete_in_background
    wait_until_blocked(locker)
    locker.exec_params(<<~SQL, [ batch_public_id ])
      INSERT INTO payroll_batches (public_id, start_date, end_date, cutoff_at, finalized_at, checksum, created_at, updated_at)
      VALUES ($1, '2026-09-01', '2026-09-15', now(), now(), repeat('a', 64), now(), now())
    SQL
    locker.exec("COMMIT")

    status, body = request.value

    expect(status).to eq(403)
    expect(body["code"]).to eq("delete_not_allowed")
    expect(TimeEntry.exists?(entry.id)).to be(true)
  ensure
    locker&.exec("ROLLBACK") if locker&.transaction_status == PG::PQTRANS_INTRANS
    locker&.close
  end

  it "refuses the delete when a protecting export commits while the request is in flight" do
    locker = independent_database_connection
    locker.exec("BEGIN")
    # What ReportExport.capture! takes on the entries it protects.
    locker.exec_params("SELECT id FROM time_entries WHERE id = $1 FOR SHARE", [ entry.id ])
    request = delete_in_background
    wait_until_blocked(locker)
    locker.exec_params(<<~SQL, [ export_public_id, "[#{entry.id}]" ])
      INSERT INTO report_exports (public_id, export_type, readiness_status, state, start_date, end_date, entry_ids,
                                  checksum, protects_entries, generated_at, last_downloaded_at, created_at, updated_at)
      VALUES ($1, 'payroll_time_summary', 'complete', 'active', '2026-09-01', '2026-09-15', $2::jsonb,
              repeat('b', 64), true, now(), now(), now(), now())
    SQL
    locker.exec("COMMIT")

    status, body = request.value

    expect(status).to eq(403)
    expect(body["code"]).to eq("delete_not_allowed")
    expect(TimeEntry.exists?(entry.id)).to be(true)
  ensure
    locker&.exec("ROLLBACK") if locker&.transaction_status == PG::PQTRANS_INTRANS
    locker&.close
  end

  it "makes a protecting export wait for a delete that already holds the entry" do
    report = { start_date: "2026-09-01", end_date: "2026-09-15", ready: true, summary: {},
               employees: [ { id: employee.id, full_name: employee.full_name, days: [ { entries: [ { id: entry.id } ] } ] } ] }
    locker = independent_database_connection
    locker.exec("BEGIN")
    # What the delete holds from its eligibility check until it commits.
    locker.exec_params("SELECT id FROM time_entries WHERE id = $1 FOR UPDATE", [ entry.id ])

    expect do
      ReportExport.transaction do
        ReportExport.connection.execute("SET LOCAL lock_timeout = '50ms'")
        ReportExport.capture!(export_type: "payroll_time_summary", report: report, protects_entries: true)
      end
    end.to raise_error(ActiveRecord::LockWaitTimeout)
    expect(ReportExport.where("entry_ids @> ?", [ entry.id ].to_json)).to be_empty
  ensure
    locker&.exec("ROLLBACK") if locker&.transaction_status == PG::PQTRANS_INTRANS
    locker&.close
  end

  it "says payroll is busy, without a 500, when finalization holds the ledger too long" do
    stub_const("Api::V1::TimeEntriesController::DELETE_LOCK_TIMEOUT", "50ms")
    locker = independent_database_connection
    locker.exec("BEGIN")
    locker.exec("LOCK TABLE time_entries IN SHARE MODE")

    delete "/api/v1/time_entries/#{entry.id}", headers: { "Authorization" => "Bearer test_token_#{employee.id}" }

    expect(response).to have_http_status(:conflict)
    expect(JSON.parse(response.body)).to include(
      "error" => "Payroll is working on this period right now. Try again in a minute.", "code" => "payroll_busy"
    )
    locker.exec("ROLLBACK")
    expect(TimeEntry.exists?(entry.id)).to be(true)
  ensure
    locker&.exec("ROLLBACK") if locker&.transaction_status == PG::PQTRANS_INTRANS
    locker&.close
  end

  it "still deletes when nothing is locking payroll" do
    delete "/api/v1/time_entries/#{entry.id}", headers: { "Authorization" => "Bearer test_token_#{employee.id}" }

    expect(response).to have_http_status(:no_content)
    expect(TimeEntry.exists?(entry.id)).to be(false)
  end
end
