# frozen_string_literal: true

require "rails_helper"

RSpec.describe Setting, type: :model do
  describe ".clock_in_location_policy" do
    it "defaults geofence enforcement to disabled until an admin opts in" do
      policy = described_class.clock_in_location_policy

      expect(policy[:enabled]).to be(false)
      expect(policy[:configured]).to be(true)
      expect(policy[:name]).to eq("AIRE Services Guam")
    end
  end

  describe ".approval_groups" do
    it "returns default approval groups when nothing is configured" do
      expect(described_class.approval_groups).to eq(
        [
          { "key" => "cfi", "label" => "CFI" },
          { "key" => "ops_maintenance", "label" => "Ops / Maintenance" }
        ]
      )
    end

    it "normalizes labels into stable keys when saving" do
      described_class.set_approval_groups!([
        { label: "Lead CFI" },
        { label: "Ops & Maintenance", key: "ops_team" }
      ])

      expect(described_class.approval_groups).to eq(
        [
          { "key" => "lead_cfi", "label" => "Lead CFI" },
          { "key" => "ops_team", "label" => "Ops & Maintenance" }
        ]
      )
      expect(described_class.approval_group_label_for("lead_cfi")).to eq("Lead CFI")
    end

    it "falls back to the label when the provided key is blank" do
      described_class.set_approval_groups!([
        { key: "", label: "Tour Ops" }
      ])

      expect(described_class.approval_groups).to eq(
        [
          { "key" => "tour_ops", "label" => "Tour Ops" }
        ]
      )
    end
  end

  describe ".update_contact_settings!" do
    it "rolls back notification emails if saving inquiry topics fails" do
      Setting.set_contact_notification_emails!([ "admin@aireservicesguam.com" ])
      Setting.set_contact_inquiry_topics!([ "Private Pilot Certificate" ])

      allow(described_class).to receive(:set_contact_inquiry_topics!).and_raise(
        ActiveRecord::RecordInvalid.new(described_class.new)
      )

      expect {
        described_class.update_contact_settings!(
          emails: [ "ops@example.com" ],
          topics: [ "Discovery Flight" ],
          public_contact: described_class.public_contact_settings
        )
      }.to raise_error(ActiveRecord::RecordInvalid)

      expect(described_class.contact_notification_emails).to eq([ "admin@aireservicesguam.com" ])
      expect(described_class.contact_inquiry_topics).to eq([ "Private Pilot Certificate" ])
    end
  end

  describe ".public_contact_settings" do
    it "defaults to AIRE's public website contact details" do
      settings = described_class.public_contact_settings

      expect(settings["phone_display"]).to eq("(671) 477-4243")
      expect(settings["email"]).to eq("admin@aireservicesguam.com")
      expect(settings["street_address"]).to eq("353 Admiral Sherman Boulevard")
      expect(settings["postal_code"]).to eq("96913")
    end

    it "normalizes partial values onto the defaults" do
      described_class.set_public_contact_settings!(
        "phone_display" => "(671) 555-0100",
        "email" => "frontdesk@example.com"
      )

      settings = described_class.public_contact_settings
      expect(settings["phone_display"]).to eq("(671) 555-0100")
      expect(settings["email"]).to eq("frontdesk@example.com")
      expect(settings["street_address"]).to eq("353 Admiral Sherman Boulevard")
    end
  end
end
