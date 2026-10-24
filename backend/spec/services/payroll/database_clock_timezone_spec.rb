# frozen_string_literal: true

require "rails_helper"
require_relative "../../support/payroll_clock_helpers"
require Rails.root.join("db/migrate/20261024010000_create_payroll_manual_allocation_revisions")

RSpec.describe "Payroll database clock timezone boundaries" do
  include PayrollClockHelpers

  let(:connection) { ActiveRecord::Base.connection }
  let(:employee) { create(:user, :employee) }
  let(:entry) do
    create(:time_entry, user: employee, work_date: payroll_calendar_at(database_clock).fetch(:start_date) + 2.days,
      status: "completed", entry_method: "clock", approval_status: nil, overtime_status: "none")
  end

  def allocation
    PayrollManualAllocation.create!(time_entry: entry, user: employee, recorded_by: employee,
      source_user_uuid: employee.payroll_integration_uuid, source_time_entry_version: entry.lock_version,
      work_date: entry.work_date, pay_date: database_clock.to_date, regular_hours: 8, overtime_hours: 0,
      external_pay_period_id: "timezone-review", external_payroll_item_id: SecureRandom.uuid,
      reason: "Synthetic direct SQL timezone boundary")
  end

  # Epoch is an independent timestamptz instant: session TimeZone cannot
  # reinterpret its value as it can a timestamp-without-time-zone assignment.
  def database_instant
    ActiveRecord::Base.uncached do
      Time.at(connection.select_value("SELECT EXTRACT(EPOCH FROM clock_timestamp())").to_d).utc
    end
  end

  def sql_insert(record)
    attributes = record.attributes_for_database.except("id")
    attributes["external_payroll_item_id"] = SecureRandom.uuid if record.is_a?(PayrollManualAllocation)
    columns = attributes.keys.map { |key| connection.quote_column_name(key) }.join(", ")
    values = attributes.values.map { |value| connection.quote(value) }.join(", ")
    connection.select_value("INSERT INTO #{record.class.quoted_table_name} (#{columns}) VALUES (#{values}) RETURNING id")
  end

  [ :time_entry, :manual_allocation ].each do |ledger|
    [ :insert, :update ].each do |operation|
      it "records the actual UTC instant for direct SQL #{ledger} #{operation} in a New York session" do
        record = ledger == :time_entry ? entry : allocation
        revision_class, source_key = if ledger == :time_entry
          [ PayrollTimeEntryRevision, :source_time_entry_id ]
        else
          [ PayrollManualAllocationRevision, :payroll_manual_allocation_id ]
        end
        connection.execute("SET LOCAL TimeZone = 'America/New_York'")
        expect(connection.select_value("SHOW TimeZone")).to eq("America/New_York")
        before = database_instant
        source_id = if operation == :insert
          sql_insert(record)
        else
          field = ledger == :time_entry ? "description" : "reason"
          connection.execute("UPDATE #{record.class.quoted_table_name} SET #{field} = 'SQL timezone update' WHERE id = #{record.id}")
          record.id
        end
        after = database_instant

        revision = revision_class.where(source_key => source_id).order(:id).last!
        expect(revision.recorded_at).to be_between(before, after).inclusive
        expect(revision.snapshot.fetch(ledger == :time_entry ? "time_entry" : "reason"))
          .to be_present
      end
    end
  end

  it "backfills new manual history at the actual UTC instant in a New York session" do
    record = allocation
    # Transactional DDL restores the original ledger and triggers after this
    # isolated example; this exercises the new migration's real backfill.
    connection.execute("DROP TABLE payroll_manual_allocation_revisions CASCADE")
    connection.execute("DROP FUNCTION capture_payroll_manual_allocation_revision() CASCADE")
    connection.execute("SET LOCAL TimeZone = 'America/New_York'")
    before = database_instant
    CreatePayrollManualAllocationRevisions.new.migrate(:up)
    after = database_instant

    revision = PayrollManualAllocationRevision.find_by!(payroll_manual_allocation_id: record.id)
    expect(revision.recorded_at).to be_between(before, after).inclusive
  end

  it "keeps a due calendar immutable in a New York session" do
    period = create(:payroll_calendar_period, **payroll_calendar_at(database_clock - 1.second))
    connection.execute("SET LOCAL TimeZone = 'America/New_York'")

    expect do
      PayrollCalendarPeriod.transaction(requires_new: true) do
        connection.execute("UPDATE payroll_calendar_periods SET request_checksum = 'timezone-bypass' WHERE id = #{period.id}")
      end
    end.to raise_error(ActiveRecord::StatementInvalid, /schedules cannot change after cutoff/)
  end
end
