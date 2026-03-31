# frozen_string_literal: true

require "rails_helper"

RSpec.describe User, type: :model do
  describe "kiosk PIN support" do
    let(:user) do
      build(:user).tap do |u|
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
  end
end
