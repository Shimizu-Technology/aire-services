# frozen_string_literal: true

require "rails_helper"
require Rails.root.join("db/migrate/20261115060000_release_draft_report_protections")

RSpec.describe ReleaseDraftReportProtections, type: :model do
  it "releases historical drafts without changing complete exports, snapshots or checksums" do
    report = { start_date: "2026-11-01", end_date: "2026-11-15", ready: true, employees: [], summary: {} }
    complete = ReportExport.capture!(export_type: "payroll_hours_pdf", report: report, protects_entries: true)
    old_draft = ReportExport.capture!(export_type: "payroll_hours_pdf", report: report, protects_entries: true)
    old_draft.update_columns(summary: { payroll_hours: { time_waiting_hours: 8, overtime_waiting_hours: 0 } })
    stale_flag = ReportExport.capture!(export_type: "payroll_hours_pdf", report: report, protects_entries: true)
    stale_flag.update_columns(summary: { pending_overtime_count: 1, payroll_hours: { time_waiting_hours: 0, overtime_waiting_hours: 0 } })
    evidence = old_draft.attributes.slice("checksum", "entry_snapshot", "entry_ids", "summary")
    described_class.new.up
    expect(old_draft.reload).to have_attributes(protects_entries: false, readiness_status: "draft")
    expect(old_draft.attributes.slice(*evidence.keys)).to eq(evidence)
    expect(complete.reload).to have_attributes(protects_entries: true, readiness_status: "complete")
    expect(stale_flag.reload.protects_entries).to be(true)
  end
end
