# frozen_string_literal: true

require "rails_helper"
require_relative "../support/frontend_fixtures"

# Every setting an owner or admin can change must be in the catalog, so the
# Settings page can explain it. These fail when one is added without an entry.
RSpec.describe SettingsCatalog do
  include FrontendFixtures

  let(:documented) { described_class.setting_keys }

  it "documents every key the Settings page can save" do
    expect(Api::V1::Admin::SettingsController::SETTING_KEYS - documented).to eq([])
  end

  it "documents every Setting default" do
    expect(Setting::DEFAULTS.keys - documented).to eq([])
  end

  it "documents every key the app writes with Setting.set" do
    sources = Rails.root.glob("{app,lib}/**/*.{rb,rake}")
    written = sources.flat_map do |path|
      source = File.read(path)
      calls = source.scan(/Setting\.set\(\s*([^,\s)]+)/).flatten
      calls += source.scan(/^\s*(?:setting = )?set\(\s*([^,\s)]+)/).flatten if path.basename.to_s == "setting.rb"
      calls.filter_map do |argument|
        case argument
        when /\A"([a-z0-9_]+)"\z/ then Regexp.last_match(1)
        when /\A(?:::)?[A-Z][\w:]*\z/ then argument.delete_prefix("::").constantize
        end
      end
    end

    expect(written).to include(Setting::MY_PAY_FOR_ALL_KEY, PayDocuments::REQUEST_NOTICE_SETTING, "approval_groups", "contact_email")
    expect(written.uniq - documented).to eq([])
  end

  it "gives every entry a label, section, help text and a real capability" do
    ids = described_class.entries.map { |entry| entry[:id] }
    expect(ids).to eq(ids.uniq)

    described_class.entries.each do |entry|
      expect(entry.slice(:id, :label, :what, :default, :example).values).to all(be_present), "#{entry[:id]} is missing help text"
      expect(SettingsCatalog::SECTIONS).to have_key(entry[:section])
      expect(User::ROLE_CAPABILITIES).to have_key(entry[:capability])
      expect(entry[:setting_keys].presence || entry[:stored_in]).to be_present, "#{entry[:id]} doesn't say where it's stored"
    end
  end

  it "states the same default the app uses" do
    described_class.entries.each do |entry|
      entry[:setting_keys].each do |key|
        default = Setting::DEFAULTS[key]
        next if default.nil?

        case default
        when "true" then expect(entry[:default]).to start_with("On"), "#{key} defaults to on"
        when "false" then expect(entry[:default]).to start_with("Off"), "#{key} defaults to off"
        when /\A-?\d+(\.\d+)?\z/ then expect(entry[:default]).to include(default), "#{key} defaults to #{default}"
        end
      end
    end
  end

  it "only points footnotes at rows the Roles & access page has" do
    viewer = User.instantiate("id" => -1, "role" => "owner", "is_active" => true)
    row_keys = AccessGuide.new(viewer: viewer).as_json[:rows].map { |row| row[:key] }

    described_class.with_access_effect.each do |entry|
      expect(row_keys).to include(*entry.dig(:access_effect, :rows))
      expect(entry[:access_effect].slice(:on, :off).values).to all(be_present)
    end
  end

  it "generates who can change each setting from the role capabilities" do
    serialized = described_class.as_json.index_by { |entry| entry[:id] }

    expect(serialized.fetch("managers_can_approve_own_time")).to include(who: "Owners and admins", who_roles: %w[owner admin])
    expect(serialized.fetch("public_contact_settings")).to include(capability: "manage_site", who: "Owners and admins")
    expect(serialized.fetch("my_pay_enabled_for_all")).to include(capability: "manage_my_pay_access", page: "Team")
  end

  it "reads whether an on/off setting is on" do
    expect(described_class.enabled?("managers_can_approve_own_time")).to be(true)
    Setting.set(Setting::MANAGERS_CAN_APPROVE_OWN_TIME_KEY, "false")
    expect(described_class.enabled?("managers_can_approve_own_time")).to be(false)

    expect(described_class.enabled?("pay_stub_kiosk_requests_enabled")).to be(false)
    Setting.set(Setting::PAY_STUB_KIOSK_REQUESTS_KEY, "true")
    expect(described_class.enabled?("pay_stub_kiosk_requests_enabled")).to be(true)
  end

  it "matches the frontend fixture" do
    expect_frontend_fixture_current("settings-catalog.json", described_class.as_json)
  end
end
