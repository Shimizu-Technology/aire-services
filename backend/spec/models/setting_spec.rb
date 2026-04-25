# frozen_string_literal: true

require "rails_helper"

RSpec.describe Setting, type: :model do
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
          topics: [ "Discovery Flight" ]
        )
      }.to raise_error(ActiveRecord::RecordInvalid)

      expect(described_class.contact_notification_emails).to eq([ "admin@aireservicesguam.com" ])
      expect(described_class.contact_inquiry_topics).to eq([ "Private Pilot Certificate" ])
    end
  end
end
