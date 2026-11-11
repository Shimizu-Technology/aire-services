# frozen_string_literal: true

require "rails_helper"

RSpec.describe AuditLogPresenter do
  let(:manager) { create(:user, :manager, first_name: "Roke", last_name: "Reyes") }
  let(:worker) { create(:user, :employee, first_name: "Ethan", last_name: "Cruz") }

  def summary_for(action, actor: manager, subject: worker, subject_name: nil, metadata: {}, changes: nil, outcome: "succeeded")
    event = AuditLog.record!(action: action, actor: actor, auditable: subject, subject_name: subject_name,
                             metadata: metadata, changes: changes, outcome: outcome)
    described_class.new(event).summary
  end

  def clock_metadata(employee = worker, work_date: "2026-11-10")
    { employee_id: employee.id, employee_name: employee.full_name, work_date: work_date }
  end

  after { Current.reset }

  it "describes clock events as plain sentences" do
    expect(summary_for("time_entry.clocked_in", actor: worker, subject_name: "0.0 hours on 2026-11-10", metadata: clock_metadata)).to eq("Ethan Cruz clocked in")
    expect(summary_for("time_entry.clocked_out", actor: worker, metadata: clock_metadata)).to eq("Ethan Cruz clocked out")
    expect(summary_for("time_entry.break_started", actor: worker, metadata: clock_metadata)).to eq("Ethan Cruz started a break")
    expect(summary_for("time_entry.clocked_out", metadata: clock_metadata)).to eq("Roke Reyes clocked out Ethan Cruz")
  end

  it "names whose time a supervisor approved or denied, and the day" do
    expect(summary_for("time_entry.approved", metadata: clock_metadata)).to eq("Roke Reyes approved Ethan Cruz's time for Nov 10, 2026")
    expect(summary_for("time_entry.overtime_denied", metadata: clock_metadata)).to eq("Roke Reyes denied Ethan Cruz's overtime for Nov 10, 2026")
    expect(summary_for("time_entry.approved", metadata: clock_metadata(manager))).to eq("Roke Reyes approved their own time for Nov 10, 2026")
  end

  it "keeps the older wording when an event predates the employee name in metadata" do
    expect(summary_for("time_entry.approved", subject_name: "8 hours on 2026-08-29")).to eq("Roke Reyes approved 8 hours on Aug 29, 2026")
  end

  it "describes My Pay views and previews" do
    expect(summary_for("my_pay.statements_viewed", actor: worker)).to eq("Ethan Cruz viewed their pay statements")
    expect(summary_for("my_pay.statement_pdf_downloaded", actor: worker)).to eq("Ethan Cruz downloaded one of their pay statements")
    expect(summary_for("my_pay.statements_viewed", actor: worker, outcome: "failed")).to eq("Ethan Cruz viewed their pay statements (could not load)")
    expect(summary_for("my_pay.preview_statements_viewed")).to eq("Roke Reyes previewed Ethan Cruz's My Pay")
  end

  it "describes role and My Pay access changes" do
    expect(summary_for("user.role_changed", changes: { role: %w[employee manager] })).to eq("Roke Reyes changed Ethan Cruz's role from Employee to Manager")
    expect(summary_for("user.my_pay_access_changed", changes: { my_pay_enabled: [ false, true ] })).to eq("Roke Reyes turned My Pay on for Ethan Cruz")
    expect(summary_for("setting.my_pay_everyone_updated", subject: Setting.set("my_pay_for_all", "false"), metadata: { enabled: false })).to eq("Roke Reyes turned My Pay off for everyone")
  end

  it "describes pay stub sends and downloads" do
    expect(summary_for("pay_documents.link_sent")).to eq("Roke Reyes sent a pay stub link to Ethan Cruz")
    expect(summary_for("pay_documents.link_downloaded", actor: nil, metadata: { accessed_by: "link_recipient" })).to eq("Link recipient downloaded a pay stub for Ethan Cruz")
  end

  it "reads leave date ranges as dates" do
    leave = create(:leave_request, user: worker, start_date: Date.new(2026, 11, 20), end_date: Date.new(2026, 11, 21))
    expect(summary_for("leave_request.approved", subject: leave)).to eq("Roke Reyes approved leave for Nov 20, 2026 through Nov 21, 2026")
  end

  it "never shows a raw event key for events without a sentence" do
    expect(summary_for("payroll_settlement_case.acknowledge")).to eq("Roke Reyes · Payroll settlement case: acknowledge · Ethan Cruz")
    expect(summary_for("user.something_new", actor: worker)).to eq("Ethan Cruz · User: something new")
  end
end
