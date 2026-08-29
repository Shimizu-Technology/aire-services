# frozen_string_literal: true

require "rails_helper"

RSpec.describe User, type: :model do
  describe "kiosk PIN support" do
    let(:user) do
      build(:user, time_tracking_enabled: true, kiosk_enabled: true).tap do |u|
        u.skip_kiosk_pin_presence_validation = true
      end
    end

    it "rotates and verifies a kiosk PIN securely" do
      pin = "731246"
      user.rotate_kiosk_pin!(pin)

      expect(user.kiosk_pin_digest).to be_present
      expect(user.kiosk_pin_lookup_hash).to be_present
      expect(user.kiosk_pin_last_rotated_at).to be_present
      expect(user.verify_kiosk_pin(pin)).to be(true)
      expect(user.verify_kiosk_pin("000000")).to be(false)
    end

    it "locks kiosk access after repeated failures" do
      user.rotate_kiosk_pin!("731247")

      described_class::KIOSK_MAX_FAILED_ATTEMPTS.times { user.register_kiosk_failure! }
      user.reload

      expect(user.kiosk_locked?).to be(true)
      expect(user.kiosk_access_enabled?).to be(false)
    end

    it "allows a personal time-tracking user to choose a PIN after first sign-in" do
      personal_user = build(:user, time_tracking_enabled: true, kiosk_enabled: true)

      expect(personal_user).to be_valid
      expect(personal_user.kiosk_pin_configured?).to be(false)
    end

    it "requires kiosk-only users to have a PIN" do
      kiosk_only_user = build(:user, :kiosk_only, kiosk_pin: nil)

      expect(kiosk_only_user).not_to be_valid
      expect(kiosk_only_user.errors[:kiosk_pin]).to include("must be set when kiosk access is enabled")
    end

    it "keeps time tracking and kiosk access in sync" do
      mismatched_user = build(:user, time_tracking_enabled: true, kiosk_enabled: false)

      expect(mismatched_user).not_to be_valid
      expect(mismatched_user.errors[:kiosk_enabled]).to include("must match time tracking access")
    end
  end
end
