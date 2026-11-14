# frozen_string_literal: true

require "rails_helper"
require Rails.root.join("db/migrate/20261114140000_close_overtime_on_denied_shifts")

RSpec.describe CloseOvertimeOnDeniedShifts, type: :model do
  it "closes only orphan reviews, audits once and cannot reopen them on rollback" do
    denied = create(:time_entry, approval_status: "denied")
    untouched = create(:time_entry, approval_status: "pending", overtime_status: "pending")
    denied.update_columns(overtime_status: "pending")
    version = denied.lock_version
    migration = described_class.new
    migration.up

    expect(denied.reload.overtime_status).to eq("denied")
    expect(denied.lock_version).to eq(version + 1)
    expect(untouched.reload.overtime_status).to eq("pending")
    audit = AuditLog.find_by!(auditable: denied, action: "time_entry.overtime_denied")
    expect(audit).to have_attributes(user_id: nil, actor_kind: "system", source: "system", outcome: "denied")
    expect(audit.metadata.fetch("review_note")).to eq("Closed with the shift's earlier denial")
    migration.up
    migration.down
    expect(AuditLog.where(auditable: denied, action: "time_entry.overtime_denied").count).to eq(1)
    expect(denied.reload.overtime_status).to eq("denied")
    expect(denied.lock_version).to eq(version + 1)
  end
end
