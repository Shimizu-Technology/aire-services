# frozen_string_literal: true

require "rails_helper"

RSpec.describe User, type: :model do
  it "assigns a permanent payroll UUID before validation" do
    user = build(:user, :employee, payroll_integration_uuid: nil)

    expect(user).to be_valid
    expect(user.payroll_integration_uuid).to match(/\A[0-9a-f-]{36}\z/)
  end

  it "does not allow the payroll UUID to change after creation" do
    user = create(:user, :employee)
    original_uuid = user.payroll_integration_uuid

    expect do
      user.update!(payroll_integration_uuid: SecureRandom.uuid)
    end.to raise_error(ActiveRecord::ReadonlyAttributeError)

    expect(user.reload.payroll_integration_uuid).to eq(original_uuid)
  end
end
