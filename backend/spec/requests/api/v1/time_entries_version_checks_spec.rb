# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Time entry optimistic version checks", type: :request do
  include ActiveSupport::Testing::TimeHelpers

  let(:admin) { create(:user, :admin) }
  let(:employee) { create(:user, :employee) }
  let(:entry) { create(:time_entry, user: employee, approval_status: "pending") }
  let(:headers) { { "Authorization" => "Bearer test_token_#{admin.id}" } }

  before { travel_to Time.utc(2026, 11, 14, 2) }
  after { travel_back }

  def protecting_export
    ReportExport.create!(
      public_id: "AIRE-PAYROLL-#{SecureRandom.hex(6).upcase}", export_type: "payroll_time_summary",
      readiness_status: "complete", state: "active", start_date: entry.work_date, end_date: entry.work_date,
      employee_ids: [ employee.id ], entry_ids: [ entry.id ], filters: {}, summary: {}, issues: {},
      entry_snapshot: [ { id: entry.id, hours: entry.hours.to_f } ], checksum: SecureRandom.hex(16),
      protects_entries: true, generated_at: Time.current, last_downloaded_at: Time.current
    )
  end

  def write_entry(action, version: :absent)
    version_params = version == :absent ? {} : { expected_version: version }
    if action == "update"
      patch "/api/v1/time_entries/#{entry.id}", headers: headers,
        params: { time_entry: { description: "Employee confirmed correction", **version_params }, correction_reason: "Verified with employee" }
    else
      post "/api/v1/time_entries/#{entry.id}/#{action}", headers: headers,
        params: { note: "Verified with employee", **version_params }
    end
  end

  %w[update approve deny approve_overtime deny_overtime].each do |action|
    context action do
      before do
        entry.update!(approval_status: "approved", overtime_status: "pending") if action.end_with?("overtime")
      end

      def expect_saved(action)
        expect(response).to have_http_status(:ok)
        expect(entry.reload.lock_version).to be > @version
        expected = case action
        when "update" then { description: "Employee confirmed correction" }
        when "approve", "deny" then { approval_status: action == "approve" ? "approved" : "denied" }
        else { overtime_status: action == "approve_overtime" ? "approved" : "denied" }
        end
        expect(entry).to have_attributes(expected)
        expect(@export.reload.state).to eq("stale")
        expect(AuditLog.count).to be > @audit_count
      end

      before do
        @export = protecting_export
        @version = entry.reload.lock_version
        @audit_count = AuditLog.count
      end

      it "saves with a matching version" do
        write_entry(action, version: @version)
        expect_saved(action)
      end

      it "preserves legacy behavior without a version" do
        write_entry(action)
        expect_saved(action)
      end

      it "rejects a mismatch before any side effects" do
        before_entries = employee.time_entries.order(:id).map(&:attributes)
        before_export = @export.attributes
        expect(Payroll::AffectedOvertimeReview).not_to receive(:reconcile)
        expect(ReportExport).not_to receive(:invalidate_for_entry!)

        expect { write_entry(action, version: @version + 1) }.not_to change(AuditLog, :count)

        expect(response).to have_http_status(:conflict)
        expect(response.parsed_body).to include("code" => "stale_entry", "error" => "This shift changed since you opened it. Nothing was saved.")
        expect(employee.time_entries.order(:id).map(&:attributes)).to eq(before_entries)
        expect(@export.reload.attributes).to eq(before_export)
      end

      it "rejects malformed versions instead of coercing them to zero" do
        expect { write_entry(action, version: "#{@version}oops") }.not_to change(AuditLog, :count)
        expect(response).to have_http_status(:conflict)
        expect(entry.reload.lock_version).to eq(@version)
      end
    end
  end

  it "rejects an employee PATCH after another client's update between GET and PATCH" do
    employee_headers = { "Authorization" => "Bearer test_token_#{employee.id}" }
    get "/api/v1/time_entries/#{entry.id}", headers: employee_headers
    viewed_version = response.parsed_body.fetch("time_entry").fetch("version")

    manager_session = ActionDispatch::Integration::Session.new(Rails.application)
    manager_session.patch "/api/v1/time_entries/#{entry.id}", headers: headers,
      params: { time_entry: { description: "Manager's intervening edit", expected_version: viewed_version } }
    expect(manager_session.response).to have_http_status(:ok)
    saved = entry.reload.attributes

    expect do
      patch "/api/v1/time_entries/#{entry.id}", headers: employee_headers,
        params: { time_entry: { end_time: "16:00", expected_version: viewed_version }, correction_reason: "Old facts" }
    end.not_to change(AuditLog, :count)

    expect(response).to have_http_status(:conflict)
    expect(entry.reload.attributes).to eq(saved)
  end

  it "checks the locked row rather than the controller's earlier read" do
    version = entry.reload.lock_version
    allow_any_instance_of(Api::V1::TimeEntriesController).to receive(:set_time_entry).and_wrap_original do |original|
      original.call
      TimeEntry.where(id: entry.id).update_all(description: "Changed before lock", lock_version: version + 1)
    end

    expect { write_entry("update", version: version) }.not_to change(AuditLog, :count)

    expect(response).to have_http_status(:conflict)
    expect(entry.reload).to have_attributes(description: "Changed before lock", lock_version: version + 1)
  end
end
