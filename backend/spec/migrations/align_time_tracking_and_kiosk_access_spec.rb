# frozen_string_literal: true

require "rails_helper"
require Rails.root.join("db/migrate/20260829013000_align_time_tracking_and_kiosk_access")
require Rails.root.join("db/migrate/20260830150000_upgrade_audit_logs")

RSpec.describe AlignTimeTrackingAndKioskAccess, type: :model do
  around do |example|
    ActiveRecord::Base.transaction(requires_new: true) do
      UpgradeAuditLogs.new.down
      AuditLog.reset_column_information
      example.run
      raise ActiveRecord::Rollback
    end
  ensure
    AuditLog.reset_column_information
  end

  def migrate_legacy_kiosk_only_user(migration)
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
    user.reload
  end

  it "deactivates and snapshots a kiosk-only user whose last access path is removed" do
    migration = described_class.new
    user = nil

    ActiveRecord::Base.transaction(requires_new: true) do
      user = migrate_legacy_kiosk_only_user(migration)

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

  it "deactivates, snapshots, and restores a kiosk-only user without a PIN" do
    migration = described_class.new

    ActiveRecord::Base.transaction(requires_new: true) do
      migration.down

      user = create(
        :user,
        :employee,
        :kiosk_only,
        clerk_id: "legacy_no_pin_#{SecureRandom.hex(8)}",
        is_active: false,
        time_tracking_enabled: false,
        kiosk_enabled: false,
        kiosk_pin: nil
      )
      User.where(id: user.id).update_all(
        is_active: true,
        time_tracking_enabled: true,
        kiosk_enabled: true
      )

      migration.up

      expect(user.reload).to have_attributes(
        personal_access_enabled: false,
        time_tracking_enabled: false,
        kiosk_enabled: false,
        is_active: false
      )
      expect(AuditLog.where(auditable: user)).to exist(
        metadata: "access capability migration: disabled kiosk-only user without PIN"
      )

      migration.down

      expect(user.reload).to have_attributes(
        time_tracking_enabled: true,
        kiosk_enabled: true,
        is_active: true
      )

      raise ActiveRecord::Rollback
    end
  end

  it "refuses to roll back over a later access change" do
    migration = described_class.new

    ActiveRecord::Base.transaction(requires_new: true) do
      user = migrate_legacy_kiosk_only_user(migration)
      User.where(id: user.id).update_all(is_active: true)

      expect {
        ActiveRecord::Base.transaction(requires_new: true) { migration.down }
      }.to raise_error(ActiveRecord::StatementInvalid, /Cannot roll back access capability alignment/)

      expect(user.reload).to have_attributes(
        time_tracking_enabled: false,
        kiosk_enabled: false,
        is_active: true
      )

      raise ActiveRecord::Rollback
    end
  end
end
