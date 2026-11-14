# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Api::V1::Admin::Settings", type: :request do
  let(:admin) { create(:user, :admin) }
  let(:employee) { create(:user, :employee) }

  let(:auth_headers_for) do
    ->(user) { { "Authorization" => "Bearer test_token_#{user.id}" } }
  end

  def json
    JSON.parse(response.body, symbolize_names: true)
  end

  describe "GET /api/v1/admin/settings" do
    it "returns time clock settings and approval groups for admin" do
      get "/api/v1/admin/settings", headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      expect(json[:settings]).to include(
        overtime_daily_threshold_hours: be_a(String),
        overtime_weekly_threshold_hours: be_a(String),
        early_clock_in_buffer_minutes: be_a(String)
      )
      expect(json[:approval_groups]).to include(
        include(key: "cfi", label: "CFI"),
        include(key: "ops_maintenance", label: "Ops / Maintenance")
      )
    end

    it "includes the settings catalog so the page can explain each setting" do
      get "/api/v1/admin/settings", headers: auth_headers_for[admin]

      expect(json[:catalog].map { |entry| entry[:id] }).to eq(SettingsCatalog.entries.map { |entry| entry[:id] })
      expect(json[:catalog].first).to include(:label, :section, :what, :default, :who, :example)
    end

    it "blocks non-admin" do
      get "/api/v1/admin/settings", headers: auth_headers_for[employee]

      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "PATCH /api/v1/admin/settings" do
    it "refuses Require while schedules are off" do
      Setting.set("schedules_enabled", "false")
      patch "/api/v1/admin/settings", params: { settings: { schedule_required_for_clock_in: "true" } }, headers: auth_headers_for[admin]
      expect(response).to have_http_status(:unprocessable_entity)
      expect(Setting.get("schedule_required_for_clock_in")).to eq("false")
    end

    it "accepts and audits Require when schedules are enabled in the same save" do
      patch "/api/v1/admin/settings", params: { settings: { schedules_enabled: "true", schedule_required_for_clock_in: "true" } }, headers: auth_headers_for[admin]
      expect(response).to have_http_status(:ok)
      audit = AuditLog.find_by!(action: "setting.schedule_required_for_clock_in_updated")
      expect(audit.changes_made).to include("schedule_required_for_clock_in" => [ false, true ])
    end

    it "normalizes, validates, clears and audits reminder recipients" do
      patch "/api/v1/admin/settings", params: { settings: { payroll_cutoff_reminder_emails: "ops@example.com; Ops@Example.com, owner@example.com" } }, headers: auth_headers_for[admin]
      expect(response).to have_http_status(:ok)
      expect(Setting.payroll_cutoff_reminder_emails).to eq([ "ops@example.com", "owner@example.com" ])
      audit = AuditLog.find_by!(action: "setting.payroll_cutoff_reminder_emails_updated")
      expect(audit.changes_made).to include("payroll_cutoff_reminder_emails" => [ "", "ops@example.com, owner@example.com" ])
      patch "/api/v1/admin/settings", params: { settings: { payroll_cutoff_reminder_emails: "invalid" } }, headers: auth_headers_for[admin]
      expect(response).to have_http_status(:unprocessable_entity)
      patch "/api/v1/admin/settings", params: { settings: { payroll_cutoff_reminder_emails: "" } }, headers: auth_headers_for[admin]
      expect(response).to have_http_status(:ok)
      expect(Setting.payroll_cutoff_reminder_emails).to eq([])
    end

    it "updates allowed keys" do
      expect do
        patch "/api/v1/admin/settings",
              params: {
                settings: {
                  early_clock_in_buffer_minutes: "10"
                }
              },
              headers: auth_headers_for[admin]
      end.to change { AuditLog.where(action: "admin.settings.update").count }.by(1)

      expect(response).to have_http_status(:ok)
      expect(json.dig(:settings, :early_clock_in_buffer_minutes)).to eq("10")
      expect(Setting.get("early_clock_in_buffer_minutes")).to eq("10")
      audit = AuditLog.where(action: "admin.settings.update").order(:id).last
      expect(audit).to have_attributes(event_category: "settings", user_id: admin.id, auditable_type: "Setting", auditable_id: 0)
      expect(audit.metadata.fetch("changed_fields")).to include("settings.early_clock_in_buffer_minutes")
    end

    it "updates approval groups" do
      patch "/api/v1/admin/settings",
            params: {
              approval_groups: [
                { key: "", label: "CFI" },
                { key: "tour_ops", label: "Tour Ops" }
              ]
            },
            headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      expect(json[:approval_groups]).to eq(
        [
          { key: "cfi", label: "CFI" },
          { key: "tour_ops", label: "Tour Ops" }
        ]
      )
      expect(Setting.approval_group_keys).to eq(%w[cfi tour_ops])
    end

    it "rejects removing approval groups that are in use" do
      create(:user, :employee, approval_group: "cfi")

      patch "/api/v1/admin/settings",
            params: {
              approval_groups: [
                { key: "ops_maintenance", label: "Ops / Maintenance" }
              ]
            },
            headers: auth_headers_for[admin]

      expect(response).to have_http_status(:unprocessable_entity)
      expect(json[:error]).to match(/Reassign users before removing departments/i)
    end

    it "rejects invalid thresholds" do
      expect do
        patch "/api/v1/admin/settings",
              params: {
                settings: {
                  overtime_daily_threshold_hours: "0"
                }
              },
              headers: auth_headers_for[admin]
      end.to change { AuditLog.where(action: "admin.settings.update", outcome: "failed").count }.by(1)

      expect(response).to have_http_status(:unprocessable_entity)
    end

    it "rejects enabling location enforcement when stored coordinates are missing" do
      Setting.set("clock_in_location_latitude", "")
      Setting.set("clock_in_location_longitude", "")

      patch "/api/v1/admin/settings",
            params: {
              settings: {
                clock_in_location_enforced: "true"
              }
            },
            headers: auth_headers_for[admin]

      expect(response).to have_http_status(:unprocessable_entity)
      expect(json[:error]).to match(/Set a valid clock-in latitude and longitude before enabling location enforcement/i)
    end
  end

  describe "GET /api/v1/admin/settings/geocode" do
    it "returns geocoding matches for admins" do
      allow(AddressGeocodingService).to receive(:search).with(query: "AIRE Guam").and_return([
        {
          display_name: "AIRE Services Guam, Barrigada, Guam",
          latitude: "13.469130",
          longitude: "144.799010"
        }
      ])

      get "/api/v1/admin/settings/geocode",
           params: { query: "AIRE Guam" },
           headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      expect(json[:results]).to eq([
        {
          display_name: "AIRE Services Guam, Barrigada, Guam",
          latitude: "13.469130",
          longitude: "144.799010"
        }
      ])
    end

    it "blocks non-admin geocoding" do
      get "/api/v1/admin/settings/geocode",
           params: { query: "AIRE Guam" },
           headers: auth_headers_for[employee]

      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "GET /api/v1/admin/settings/place_autocomplete" do
    it "returns Google Places suggestions for admins" do
      allow(GooglePlacesService).to receive(:autocomplete)
        .with(query: "AIRE", session_token: "session-123")
        .and_return([
          {
            place_id: "places/aire",
            description: "AIRE Services Guam, Barrigada, Guam",
            main_text: "AIRE Services Guam",
            secondary_text: "Barrigada, Guam"
          }
        ])

      get "/api/v1/admin/settings/place_autocomplete",
          params: { query: "AIRE", session_token: "session-123" },
          headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      expect(json[:suggestions]).to eq([
        {
          place_id: "places/aire",
          description: "AIRE Services Guam, Barrigada, Guam",
          main_text: "AIRE Services Guam",
          secondary_text: "Barrigada, Guam"
        }
      ])
    end

    it "blocks non-admin autocomplete" do
      get "/api/v1/admin/settings/place_autocomplete",
          params: { query: "AIRE", session_token: "session-123" },
          headers: auth_headers_for[employee]

      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "GET /api/v1/admin/settings/place_details" do
    it "returns selected place details for admins" do
      allow(GooglePlacesService).to receive(:details)
        .with(place_id: "places/aire", session_token: "session-123")
        .and_return(
          place_id: "places/aire",
          display_name: "AIRE Services Guam",
          formatted_address: "1780 Admiral Sherman Boulevard, Barrigada, Guam 96913",
          latitude: "13.46913",
          longitude: "144.79901",
          plus_code: "7R65FQ9X+MM"
        )

      get "/api/v1/admin/settings/place_details",
          params: { place_id: "places/aire", session_token: "session-123" },
          headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      expect(json[:place]).to eq(
        place_id: "places/aire",
        display_name: "AIRE Services Guam",
        formatted_address: "1780 Admiral Sherman Boulevard, Barrigada, Guam 96913",
        latitude: "13.46913",
        longitude: "144.79901",
        plus_code: "7R65FQ9X+MM"
      )
    end

    it "blocks non-admin place details" do
      get "/api/v1/admin/settings/place_details",
          params: { place_id: "places/aire", session_token: "session-123" },
          headers: auth_headers_for[employee]

      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "Managers can approve their own time" do
    let(:owner) { create(:user, :owner) }
    let(:manager) { create(:user, :manager) }
    let(:key) { Setting::MANAGERS_CAN_APPROVE_OWN_TIME_KEY }

    def audit_rows
      AuditLog.where(action: "setting.#{key}_updated").order(:id)
    end

    it "defaults to on" do
      get "/api/v1/admin/settings", headers: auth_headers_for[admin]

      expect(json.dig(:settings, :managers_can_approve_own_time)).to eq("true")
    end

    it "lets owners and admins change it, auditing before and after" do
      patch "/api/v1/admin/settings", params: { settings: { key => false } }, headers: auth_headers_for[admin], as: :json
      expect(response).to have_http_status(:ok)
      expect(json.dig(:settings, :managers_can_approve_own_time)).to eq("false")
      expect(Setting.managers_can_approve_own_time?).to be(false)

      patch "/api/v1/admin/settings", params: { settings: { key => "true" } }, headers: auth_headers_for[owner], as: :json
      expect(response).to have_http_status(:ok)
      expect(Setting.managers_can_approve_own_time?).to be(true)

      expect(audit_rows.map { |row| [ row.user_id, row.event_category, row.changes_made ] }).to eq([
        [ admin.id, "settings", { key => [ true, false ] } ],
        [ owner.id, "settings", { key => [ false, true ] } ]
      ])
    end

    it "does not write a change row when the value is unchanged" do
      patch "/api/v1/admin/settings", params: { settings: { key => "true" } }, headers: auth_headers_for[admin], as: :json

      expect(response).to have_http_status(:ok)
      expect(audit_rows).to be_empty
    end

    it "rejects values other than true or false" do
      patch "/api/v1/admin/settings", params: { settings: { key => "sometimes" } }, headers: auth_headers_for[admin], as: :json

      expect(response).to have_http_status(:unprocessable_entity)
      expect(Setting.managers_can_approve_own_time?).to be(true)
    end

    it "refuses managers and employees" do
      [ manager, employee ].each do |user|
        patch "/api/v1/admin/settings", params: { settings: { key => "false" } }, headers: auth_headers_for[user], as: :json
        expect(response).to have_http_status(:forbidden), user.role
      end

      expect(Setting.managers_can_approve_own_time?).to be(true)
      expect(audit_rows).to be_empty
    end
  end

  describe "pay stub switches" do
    let(:owner) { create(:user, :owner) }
    let(:manager) { create(:user, :manager) }
    let(:keys) { [ Setting::PAY_STUB_KIOSK_REQUESTS_KEY, Setting::PAY_STUB_SELF_EMAIL_KEY ] }

    it "are both off by default" do
      get "/api/v1/admin/settings", headers: auth_headers_for[admin]

      expect(json[:settings]).to include(pay_stub_kiosk_requests_enabled: "false", pay_stub_self_email_enabled: "false")
      expect(PayDocuments.kiosk_requests_enabled?).to be(false)
      expect(PayDocuments.self_email_enabled?).to be(false)
    end

    it "lets owners and admins turn each one on and off, auditing before and after" do
      patch "/api/v1/admin/settings", params: { settings: { keys.first => true } }, headers: auth_headers_for[admin], as: :json
      expect(response).to have_http_status(:ok)
      expect(PayDocuments.kiosk_requests_enabled?).to be(true)
      expect(PayDocuments.self_email_enabled?).to be(false)

      patch "/api/v1/admin/settings", params: { settings: { keys.last => true } }, headers: auth_headers_for[owner], as: :json
      patch "/api/v1/admin/settings", params: { settings: { keys.first => false } }, headers: auth_headers_for[owner], as: :json
      expect(PayDocuments.kiosk_requests_enabled?).to be(false)
      expect(PayDocuments.self_email_enabled?).to be(true)

      rows = AuditLog.where(action: keys.map { |key| "setting.#{key}_updated" }).order(:id)
      expect(rows.map { |row| [ row.user_id, row.event_category, row.changes_made ] }).to eq([
        [ admin.id, "settings", { keys.first => [ false, true ] } ],
        [ owner.id, "settings", { keys.last => [ false, true ] } ],
        [ owner.id, "settings", { keys.first => [ true, false ] } ]
      ])
    end

    it "refuses managers and employees" do
      [ manager, employee ].each do |user|
        patch "/api/v1/admin/settings", params: { settings: { keys.first => "true" } }, headers: auth_headers_for[user], as: :json
        expect(response).to have_http_status(:forbidden), user.role
      end
      expect(PayDocuments.kiosk_requests_enabled?).to be(false)
    end
  end

  describe "Use schedules" do
    let(:owner) { create(:user, :owner) }
    let(:manager) { create(:user, :manager) }
    let(:key) { Setting::SCHEDULES_ENABLED_KEY }

    def audit_rows
      AuditLog.where(action: "setting.#{key}_updated").order(:id)
    end

    it "defaults to off" do
      get "/api/v1/admin/settings", headers: auth_headers_for[admin]

      expect(json.dig(:settings, :schedules_enabled)).to eq("false")
      expect(Setting.schedules_enabled?).to be(false)
    end

    it "lets owners and admins turn it on and off, auditing before and after" do
      patch "/api/v1/admin/settings", params: { settings: { key => true } }, headers: auth_headers_for[admin], as: :json
      expect(response).to have_http_status(:ok)
      expect(json.dig(:settings, :schedules_enabled)).to eq("true")
      expect(Setting.schedules_enabled?).to be(true)

      patch "/api/v1/admin/settings", params: { settings: { key => false } }, headers: auth_headers_for[owner], as: :json
      expect(response).to have_http_status(:ok)
      expect(Setting.schedules_enabled?).to be(false)

      expect(audit_rows.map { |row| [ row.user_id, row.event_category, row.changes_made, row.metadata ] }).to eq([
        [ admin.id, "settings", { key => [ false, true ] }, { "key" => key, "enabled" => true } ],
        [ owner.id, "settings", { key => [ true, false ] }, { "key" => key, "enabled" => false } ]
      ])
      expect(AuditLogPresenter.new(audit_rows.first).summary).to end_with("turned schedules on")
      expect(AuditLogPresenter.new(audit_rows.last).summary).to end_with("turned schedules off")
    end

    it "does not write a change row when the value is unchanged" do
      patch "/api/v1/admin/settings", params: { settings: { key => "false" } }, headers: auth_headers_for[admin], as: :json

      expect(response).to have_http_status(:ok)
      expect(audit_rows).to be_empty
    end

    it "rejects values other than true or false" do
      patch "/api/v1/admin/settings", params: { settings: { key => "maybe" } }, headers: auth_headers_for[admin], as: :json

      expect(response).to have_http_status(:unprocessable_entity)
      expect(Setting.schedules_enabled?).to be(false)
    end

    it "refuses managers and employees" do
      [ manager, employee ].each do |user|
        patch "/api/v1/admin/settings", params: { settings: { key => "true" } }, headers: auth_headers_for[user], as: :json
        expect(response).to have_http_status(:forbidden), user.role
      end

      expect(Setting.schedules_enabled?).to be(false)
      expect(audit_rows).to be_empty
    end

    it "reaches every signed-in role through their profile, so the menu can hide Schedule" do
      [ owner, admin, manager, employee ].each do |user|
        get "/api/v1/auth/me", headers: auth_headers_for[user]
        expect(response.parsed_body.dig("user", "schedules_enabled")).to be(false), user.role
      end

      Setting.set(key, "true")
      get "/api/v1/auth/me", headers: auth_headers_for[employee]
      expect(response.parsed_body.dig("user", "schedules_enabled")).to be(true)
    end

    it "does not change the clock-in rules" do
      expect(Setting.get("schedule_required_for_clock_in")).to eq("false")
      patch "/api/v1/admin/settings", params: { settings: { key => true } }, headers: auth_headers_for[admin], as: :json
      expect(json.dig(:settings, :schedule_required_for_clock_in)).to eq("false")
      expect(json.dig(:settings, :early_clock_in_buffer_minutes)).to eq("5")
    end
  end

  describe "Auto-approve ordinary shifts" do
    let(:owner) { create(:user, :owner) }
    let(:manager) { create(:user, :manager) }
    let(:key) { Setting::AUTO_APPROVE_ORDINARY_SHIFTS_KEY }
    let(:hours_key) { Setting::AUTO_APPROVE_MAX_SHIFT_HOURS_KEY }

    def audit_rows
      AuditLog.where(action: [ "setting.#{key}_updated", "setting.#{hours_key}_updated" ]).order(:id)
    end

    it "is off by default with a 12-hour limit" do
      get "/api/v1/admin/settings", headers: auth_headers_for[admin]

      expect(json[:settings]).to include(auto_approve_ordinary_shifts: "false", auto_approve_max_shift_hours: "12")
      expect(Setting.auto_approve_ordinary_shifts?).to be(false)
      expect(Setting.auto_approve_max_shift_hours).to eq(12.0)
    end

    it "lets owners and admins change the switch and the limit, auditing before and after" do
      patch "/api/v1/admin/settings", params: { settings: { key => true } }, headers: auth_headers_for[owner], as: :json
      expect(response).to have_http_status(:ok)
      expect(Setting.auto_approve_ordinary_shifts?).to be(true)

      patch "/api/v1/admin/settings", params: { settings: { hours_key => "10.5" } }, headers: auth_headers_for[admin], as: :json
      expect(response).to have_http_status(:ok)
      expect(Setting.auto_approve_max_shift_hours).to eq(10.5)

      patch "/api/v1/admin/settings", params: { settings: { key => false, hours_key => "10.5" } }, headers: auth_headers_for[admin], as: :json
      expect(Setting.auto_approve_ordinary_shifts?).to be(false)

      expect(audit_rows.map { |row| [ row.user_id, row.event_category, row.changes_made ] }).to eq([
        [ owner.id, "settings", { key => [ false, true ] } ],
        [ admin.id, "settings", { hours_key => [ 12.0, 10.5 ] } ],
        [ admin.id, "settings", { key => [ true, false ] } ]
      ])
    end

    it "rejects a limit outside 1 to 23 hours and non-boolean switch values" do
      [ "0", "24", "abc" ].each do |value|
        patch "/api/v1/admin/settings", params: { settings: { hours_key => value } }, headers: auth_headers_for[admin], as: :json
        expect(response).to have_http_status(:unprocessable_entity), value
      end
      patch "/api/v1/admin/settings", params: { settings: { key => "sometimes" } }, headers: auth_headers_for[admin], as: :json
      expect(response).to have_http_status(:unprocessable_entity)

      expect(Setting.auto_approve_max_shift_hours).to eq(12.0)
      expect(Setting.auto_approve_ordinary_shifts?).to be(false)
      expect(audit_rows).to be_empty
    end

    it "refuses managers and employees" do
      [ manager, employee ].each do |user|
        patch "/api/v1/admin/settings", params: { settings: { key => "true", hours_key => "8" } }, headers: auth_headers_for[user], as: :json
        expect(response).to have_http_status(:forbidden), user.role
      end

      expect(Setting.auto_approve_ordinary_shifts?).to be(false)
      expect(audit_rows).to be_empty
    end
  end
end
