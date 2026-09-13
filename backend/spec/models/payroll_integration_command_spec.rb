# frozen_string_literal: true

require "rails_helper"

RSpec.describe PayrollIntegrationCommand, type: :model do
  def command_attributes
    {
      command_id: SecureRandom.uuid,
      action: "time_entry.approve",
      actor: create(:user, :admin),
      actor_payroll_integration_uuid: nil,
      target_type: "TimeEntry",
      target_id: 42,
      expected_version: 0,
      request_checksum: Digest::SHA256.hexdigest("request"),
      response_status: 200
    }
  end

  it "permits only small, non-personal replay metadata" do
    attributes = command_attributes
    attributes[:actor_payroll_integration_uuid] = attributes.fetch(:actor).payroll_integration_uuid
    valid = described_class.new(attributes.merge(result_metadata: { result_version: 1, decision: "approve" }))
    personal = described_class.new(attributes.merge(result_metadata: { result: { employee: { email: "person@example.com" } } }))
    oversized = described_class.new(attributes.merge(result_metadata: { result: "x" * 2.kilobytes }))

    expect(valid).to be_valid
    expect(personal).not_to be_valid
    expect(personal.errors[:result_metadata]).to include("contains payroll or personal data")
    expect(oversized).not_to be_valid
    expect(oversized.errors[:result_metadata]).to include("is too large")
  end


  it "rejects duplicate command IDs and response statuses outside 200 through 299" do
    attributes = command_attributes
    attributes[:actor_payroll_integration_uuid] = attributes.fetch(:actor).payroll_integration_uuid
    described_class.create!(attributes.merge(result_metadata: { result_version: 1 }))

    expect(described_class.new(attributes.merge(result_metadata: { result_version: 1 }))).not_to be_valid
    [ 199, 300 ].each do |status|
      candidate = described_class.new(
        attributes.merge(command_id: SecureRandom.uuid, response_status: status, result_metadata: {})
      )
      expect(candidate).not_to be_valid
      expect(candidate.errors[:response_status]).to be_present
    end
  end

  it "retains a pseudonymous actor reference without blocking user deletion" do
    create(:user, :admin)
    actor = create(:user, :admin)
    receipt = described_class.create!(
      command_attributes.merge(
        actor: actor,
        actor_payroll_integration_uuid: actor.payroll_integration_uuid,
        result_metadata: { result_version: 1 }
      )
    )
    actor_uuid = actor.payroll_integration_uuid

    expect { actor.destroy! }.not_to change(described_class, :count)
    expect(receipt.reload).to have_attributes(
      actor_id: actor.id,
      actor_payroll_integration_uuid: actor_uuid,
      actor: nil
    )
  end
end
