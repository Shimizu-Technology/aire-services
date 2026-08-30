# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Api::V1::Admin::AuditLogs", type: :request do
  let(:admin) { create(:user, :admin) }
  let(:employee) { create(:user, :employee) }
  let(:auth_headers_for) { ->(user) { { "Authorization" => "Bearer test_token_#{user.id}" } } }

  def json
    JSON.parse(response.body, symbolize_names: true)
  end

  before do
    AuditLog.record!(
      action: "time_entry.approved",
      actor: admin,
      subject_type: "TimeEntry",
      subject_id: 44,
      subject_name: "8 hours on 2026-08-29",
      event_category: "approvals",
      source: "admin",
      metadata: { review_note: "Verified" }
    )
    AuditLog.record!(
      action: "user.updated",
      actor: admin,
      auditable: employee,
      event_category: "users",
      metadata: { changed_fields: [ "role" ] }
    )
    Current.reset
  end

  it "returns newest-first, filterable event details to admins" do
    get "/api/v1/admin/audit_logs",
        params: { event_category: "approvals", search: "8 hours" },
        headers: auth_headers_for[admin]

    expect(response).to have_http_status(:ok)
    expect(json.dig(:pagination, :total)).to eq(1)
    expect(json.dig(:audit_logs, 0)).to include(
      action: "time_entry.approved",
      event_category: "approvals",
      source: "admin"
    )
    expect(json.dig(:audit_logs, 0, :actor, :name)).to eq(admin.full_name)
    expect(json.dig(:audit_logs, 0, :details, :review_note)).to eq("Verified")
  end

  it "matches human-readable searches to underscored actions and compact record types" do
    get "/api/v1/admin/audit_logs", params: { search: "time entry" }, headers: auth_headers_for[admin]

    expect(response).to have_http_status(:ok)
    expect(json.dig(:pagination, :total)).to eq(1)
    expect(json.dig(:audit_logs, 0, :action)).to eq("time_entry.approved")
  end

  it "blocks non-admin staff" do
    get "/api/v1/admin/audit_logs", headers: auth_headers_for[employee]

    expect(response).to have_http_status(:forbidden)
  end

  it "rejects malformed record and date filters without querying invalid values" do
    get "/api/v1/admin/audit_logs", params: { subject_id: "not-a-number" }, headers: auth_headers_for[admin]
    expect(response).to have_http_status(:bad_request)

    get "/api/v1/admin/audit_logs", params: { from: "not-a-date" }, headers: auth_headers_for[admin]
    expect(response).to have_http_status(:bad_request)
  end

  it "exports the filtered snapshot and records the export separately" do
    malicious = create(:user, :employee, first_name: "=FORMULA", last_name: "Person")
    AuditLog.record!(action: "user.updated", auditable: malicious, actor: admin, event_category: "users")
    Current.reset

    expect do
      get "/api/v1/admin/audit_logs/export", params: { event_category: "users" }, headers: auth_headers_for[admin]
    end.to change { AuditLog.where(action: "audit_history.exported").count }.by(1)

    expect(response).to have_http_status(:ok)
    expect(response.media_type).to eq("text/csv")
    expect(response.body).to include("Occurred at,Actor")
    expect(response.body).to include("'=FORMULA Person")
    expect(response.body).not_to include("audit_history.exported")
  end
end
