# frozen_string_literal: true

require "rails_helper"

RSpec.describe PayrollIntegrationGrant, type: :model do
  include ActiveSupport::Testing::TimeHelpers

  it "issues a one-time raw token and authenticates by its stored digest" do
    grant = described_class.issue!(user: create(:user, :admin), capabilities: [ "time_approval" ])
    token = grant.issued_token

    expect(token).to start_with("aire_pay_")
    expect(grant.token_digest).to eq(Digest::SHA256.hexdigest(token))
    expect(grant.token_digest).not_to include(token)
    expect(grant.expires_at).to be_within(1.second).of(Time.current + 90.days)
    expect(described_class.authenticate(token)).to eq(grant)
    expect(described_class.authenticate("#{token}wrong")).to be_nil
    expect(described_class.find(grant.id).issued_token).to be_nil
  end

  it "rejects unsupported capabilities and grants for non-administrators" do
    expect do
      described_class.issue!(user: create(:user, :employee), capabilities: [ "time_approval" ])
    end.to raise_error(ActiveRecord::RecordInvalid, /administrator/)

    expect do
      described_class.issue!(user: create(:user, :admin), capabilities: [ "database_admin" ])
    end.to raise_error(ActiveRecord::RecordInvalid, /unsupported/)
  end

  it "supports separately scoped correction and settlement-case commands" do
    grant = described_class.issue!(
      user: create(:user, :admin),
      capabilities: %w[time_correction settlement_case_management]
    )

    expect(grant.allows?("time_correction")).to be(true)
    expect(grant.allows?("settlement_case_management")).to be(true)
    expect(grant.allows?("payroll_finalization")).to be(false)
  end

  it "rejects an unbounded grant lifetime" do
    expect do
      described_class.issue!(
        user: create(:user, :admin),
        capabilities: [ "time_approval" ],
        expires_at: 2.years.from_now
      )
    end.to raise_error(ActiveRecord::RecordInvalid, /no more than one year/)
  end

  it "keeps active grant expiry bounded on updates and reactivation" do
    grant = described_class.issue!(user: create(:user, :admin), capabilities: [ "time_approval" ])

    grant.expires_at = nil
    expect(grant).not_to be_valid
    grant.expires_at = 2.years.from_now
    expect(grant).not_to be_valid

    grant.assign_attributes(active: false, expires_at: nil)
    expect(grant.save).to be(true)
    grant.active = true
    expect(grant).not_to be_valid
  end

  it "rejects revoked and expired delegation tokens" do
    revoked = described_class.issue!(user: create(:user, :admin), capabilities: [ "time_approval" ])
    revoked_token = revoked.issued_token
    revoked.update!(active: false)
    expiring = described_class.issue!(
      user: create(:user, :admin),
      capabilities: [ "payroll_finalization" ],
      expires_at: 1.minute.from_now
    )

    expect(described_class.authenticate(revoked_token)).to be_nil
    travel 2.minutes do
      expect(described_class.authenticate(expiring.issued_token)).to be_nil
    end
  end
end
