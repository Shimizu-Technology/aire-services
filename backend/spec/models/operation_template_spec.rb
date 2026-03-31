# frozen_string_literal: true

require "rails_helper"

RSpec.describe OperationTemplate, type: :model do
  let!(:admin) do
    User.create!(
      clerk_id: "spec-admin-operation-template-model",
      email: "admin-operation-template-model@example.com",
      role: "admin",
      first_name: "Spec",
      last_name: "Admin"
    )
  end

  describe "recurrence validations" do
    it "requires recurrence interval when recurrence type is custom" do
      template = described_class.new(
        name: "Custom Template Missing Interval #{SecureRandom.hex(4)}",
        category: "general",
        recurrence_type: "custom",
        auto_generate: true,
        created_by: admin
      )

      expect(template).not_to be_valid
      expect(template.errors[:recurrence_interval]).to include("is required when recurrence type is custom")
    end

    it "rejects non-positive recurrence interval values" do
      template = described_class.new(
        name: "Custom Template Invalid Interval #{SecureRandom.hex(4)}",
        category: "general",
        recurrence_type: "custom",
        recurrence_interval: 0,
        auto_generate: true,
        created_by: admin
      )

      expect(template).not_to be_valid
      expect(template.errors[:recurrence_interval]).to include("must be greater than 0")
    end
  end
end
