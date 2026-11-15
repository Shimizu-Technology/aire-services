require "rails_helper"

RSpec.describe ReportExport do
  let(:report) { { start_date: "2026-11-01", end_date: "2026-11-15", ready: true, employees: [], summary: { payroll_hours: { time_waiting_hours: 0, overtime_waiting_hours: 0 } } } }

  it "protects complete downloads but never drafts, including waiting overtime on approved shifts" do
    complete = described_class.capture!(export_type: "payroll_hours_pdf", report: report, protects_entries: true)
    expect(complete).to have_attributes(readiness_status: "complete", protects_entries: true)
    [ { time_waiting_hours: 8 }, { overtime_waiting_hours: 2 } ].each do |waiting|
      draft = described_class.capture!(export_type: "payroll_hours_pdf", report: report.deep_merge(summary: { payroll_hours: waiting }), protects_entries: true)
      expect(draft).to have_attributes(readiness_status: "draft", protects_entries: false)
    end
    draft = described_class.capture!(export_type: "payroll_hours_pdf", report: report.merge(ready: false), protects_entries: true)
    expect(draft).to have_attributes(readiness_status: "draft", protects_entries: false)
  end
end
