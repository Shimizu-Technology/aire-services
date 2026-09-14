# frozen_string_literal: true

require "rails_helper"

RSpec.describe PayrollAccountLinkSession, type: :model do
  let(:admin) { create(:user, :admin, is_active: true, personal_access_enabled: true) }

  it "creates a short-lived opaque request and permanently links one external actor" do
    session = described_class.issue!(
      external_actor_id: "cornerstone-user-42",
      external_actor_email: "chels@example.com",
      return_url: "https://payroll.example.com/time-tracking-sources?source_id=7"
    )

    expect(session.issued_token).to start_with("aire_link_")
    expect(session.expires_at).to be_within(2.seconds).of(10.minutes.from_now)

    link = session.authorize!(admin)

    expect(link).to have_attributes(
      user: admin,
      external_actor_id: "cornerstone-user-42",
      external_actor_email: "chels@example.com",
      active: true,
      revoked_at: nil
    )
    expect(link).to be_connected
    expect(session.reload).to have_attributes(linked_user: admin)
    expect(session.consumed_at).to be_present
  end

  it "cannot be replayed" do
    session = described_class.issue!(
      external_actor_id: "42",
      external_actor_email: "chels@example.com",
      return_url: "https://payroll.example.com/time-tracking-sources"
    )
    session.authorize!(admin)

    expect { session.authorize!(admin) }
      .to raise_error(ActiveRecord::RecordInvalid, /already been used/)
  end

  it "can revoke a link after the AIRE administrator loses access" do
    session = described_class.issue!(
      external_actor_id: "42",
      external_actor_email: "chels@example.com",
      return_url: "https://payroll.example.com/time-tracking-sources"
    )
    link = session.authorize!(admin)
    admin.update!(is_active: false)

    expect { link.revoke! }.to change { link.reload.active? }.from(true).to(false)
    expect(link.revoked_at).to be_present
  end

  it "rejects insecure production-style callback URLs" do
    allow(Rails.env).to receive(:development?).and_return(false)
    allow(Rails.env).to receive(:test?).and_return(false)

    session = described_class.new(
      external_actor_id: "42",
      return_url: "http://payroll.example.com/time-tracking-sources"
    )

    expect(session).not_to be_valid
    expect(session.errors[:return_url]).to include("must be a secure HTTP URL")
  end
end
