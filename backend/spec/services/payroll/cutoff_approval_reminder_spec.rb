# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::CutoffApprovalReminder do
  include ActiveSupport::Testing::TimeHelpers

  let(:guam) { ActiveSupport::TimeZone["Pacific/Guam"] }
  let(:period) { create(:payroll_calendar_period) }
  let(:employee) { create(:user, :employee, first_name: "Ada", last_name: "O'Neil") }
  let(:category) { create(:time_category) }
  let(:delivered) { [] }
  let(:cutoff_day) { period.cutoff_at.in_time_zone(guam).to_date }

  before do
    Setting.set("payroll_cutoff_reminder_emails", "approver@example.test, second@example.test")
    allow(StagingMailTransport).to receive(:deliver) { |payload, **| delivered << payload }
  end

  def entry(approval: "pending", overtime: "none", date: period.start_date)
    create(:time_entry, user: employee, time_category: category, work_date: date, status: "completed",
      entry_method: "manual", approval_status: approval, overtime_status: overtime)
  end

  def at(days_before, hour)
    travel_to(guam.local(cutoff_day.year, cutoff_day.month, cutoff_day.day, hour) - days_before.days) { described_class.call_due }
  end

  it "emails approvers two days before the cutoff and lists what is waiting" do
    entry
    entry(approval: "approved", overtime: "pending", date: period.start_date + 1.day)

    expect(at(2, 9)).to contain_exactly(hash_including(status: "sent"))

    mail = delivered.sole
    expect(mail[:to]).to eq([ "approver@example.test", "second@example.test" ])
    expect(mail[:subject]).to include("2 entries waiting")
    expect(mail[:html]).to include("O&#39;Neil", "1 time, 1 overtime")
    # The approvals page; old /admin/time?tab=approvals links redirect there.
    expect(mail[:html]).to include("/admin/approvals")
    expect(mail[:html]).not_to include("/admin/time")
  end

  it "waits until the morning, and sends each day's reminder only once" do
    entry

    expect(at(2, 7).sole[:status]).to eq("not_due")
    expect(at(2, 9).sole[:status]).to eq("sent")
    expect(at(2, 10).sole[:status]).to eq("already_sent")
    expect(at(1, 9).sole[:status]).to eq("sent")
    expect(delivered.size).to eq(2)
  end

  it "gives each day's reminder a stable key so a retry cannot resend it" do
    entry
    keys = []
    allow(StagingMailTransport).to receive(:deliver) { |_payload, options:| keys << options.fetch(:idempotency_key) }

    allow(AuditLog).to receive(:record!).and_raise(RuntimeError, "audit write failed")
    expect(at(2, 9).sole[:status]).to eq("failed")
    allow(AuditLog).to receive(:record!).and_call_original
    expect(at(2, 10).sole[:status]).to eq("sent")
    expect(at(1, 9).sole[:status]).to eq("sent")

    expect(keys.first).to eq(keys.second)
    expect(keys.last).not_to eq(keys.first)
  end

  it "sends nothing when every entry is approved" do
    entry(approval: "approved", overtime: "approved")

    expect(at(2, 9).sole[:status]).to eq("nothing_pending")
    expect(delivered).to be_empty
  end

  it "sends nothing when no recipients are configured" do
    entry
    Setting.set("payroll_cutoff_reminder_emails", "")

    expect(at(2, 9).sole[:status]).to eq("no_recipients")
    expect(AuditLog.where(action: described_class::ACTION)).to be_empty
  end

  it "ignores denied entries and periods that have already locked" do
    entry(approval: "denied", overtime: "pending")
    expect(at(2, 9).sole[:status]).to eq("nothing_pending")

    entry
    period.update_columns(status: "finalized")
    expect(at(1, 9)).to be_empty
  end

  it "retries on the next run when the email fails" do
    entry
    allow(StagingMailTransport).to receive(:deliver).and_raise(RuntimeError, "mail down")
    expect(at(2, 9).sole[:status]).to eq("failed")

    allow(StagingMailTransport).to receive(:deliver) { |payload, **| delivered << payload }
    expect(at(2, 10).sole[:status]).to eq("sent")
  end
end
