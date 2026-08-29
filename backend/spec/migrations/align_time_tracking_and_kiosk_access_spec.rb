# frozen_string_literal: true

require "rails_helper"
require Rails.root.join("db/migrate/20260829013000_align_time_tracking_and_kiosk_access")

RSpec.describe AlignTimeTrackingAndKioskAccess, type: :model do
  it "deactivates and snapshots a kiosk-only user whose last access path is removed" do
    migration = described_class.new
    user = nil

    ActiveRecord::Base.transaction(requires_new: true) do
      migration.down

      user = create(
        :user,
        :employee,
        :kiosk_only,
        clerk_id: "legacy_access_#{SecureRandom.hex(8)}",
        is_active: false,
        time_tracking_enabled: false,
        kiosk_enabled: false,
        kiosk_pin: nil
      )
      User.where(id: user.id).update_all(is_active: true, kiosk_enabled: true)

      migration.up

      expect(user.reload).to have_attributes(
        personal_access_enabled: false,
        time_tracking_enabled: false,
        kiosk_enabled: false,
        is_active: false
      )
      expect(AuditLog.where(auditable: user)).to exist(
        metadata: "access capability migration: deactivated kiosk-only user after access removal"
      )

      migration.down

      expect(user.reload).to have_attributes(
        time_tracking_enabled: false,
        kiosk_enabled: true,
        is_active: true
      )

      raise ActiveRecord::Rollback
    end
  end
end
