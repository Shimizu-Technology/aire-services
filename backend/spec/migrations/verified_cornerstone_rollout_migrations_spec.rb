# frozen_string_literal: true

require "rails_helper"
require Rails.root.join("db/migrate/20260921020000_set_verified_francisco_maintenance_rate")
require Rails.root.join("db/migrate/20260921020100_record_verified_jeremiah_payment_hold")
require Rails.root.join("db/migrate/20260921020200_connect_verified_cornerstone_payroll_admins")

RSpec.describe "verified Cornerstone rollout migrations", type: :model do
  def create_francisco!(**attributes)
    create(
      :user,
      :employee,
      {
        id: SetVerifiedFranciscoMaintenanceRate::SOURCE_USER_ID,
        first_name: "Francisco",
        last_name: "San Nicolas",
        payroll_integration_uuid: SetVerifiedFranciscoMaintenanceRate::SOURCE_UUID
      }.merge(attributes)
    )
  end

  def create_maintenance_category!
    create(:time_category, key: SetVerifiedFranciscoMaintenanceRate::CATEGORY_KEY, is_active: true)
  end

  describe SetVerifiedFranciscoMaintenanceRate do
    subject(:migration) { described_class.new }

    it "fails closed when the verified identity is absent or changed" do
      expect { migration.up }.to raise_error(RuntimeError, /identity is missing/)

      create_francisco!(last_name: "Changed")
      expect { migration.up }.to raise_error(RuntimeError, /identity changed/)
    end

    it "assigns maintenance, sets the verified rate, snapshots only completed work, and replays safely" do
      person = create_francisco!
      category = create_maintenance_category!
      completed = create(
        :time_entry, user: person, time_category: category, status: "completed",
        effective_rate_cents_snapshot: nil
      )
      active = create(
        :time_entry, user: person, time_category: category, status: "clocked_in",
        entry_method: "clock", clock_source: "kiosk", end_time: nil, hours: 0,
        effective_rate_cents_snapshot: nil
      )

      expect { migration.up }.to change(UserTimeCategory, :count).by(1)
      expect { migration.up }.not_to change(UserTimeCategory, :count)

      expect(EmployeePayRate.find_by!(user: person, time_category: category).hourly_rate_cents).to eq(1_600)
      expect(completed.reload.effective_rate_cents_snapshot).to eq(1_600)
      expect(active.reload.effective_rate_cents_snapshot).to be_nil
      audit = AuditLog.find_by!(action: "payroll.staff_rate.verified", auditable: person)
      expect(audit.metadata).to include(
        "operational_name" => SetVerifiedFranciscoMaintenanceRate::OPERATIONAL_NAME,
        "time_category_key" => SetVerifiedFranciscoMaintenanceRate::CATEGORY_KEY
      )
      expect(AuditLog.where(action: "payroll.staff_rate.verified", auditable: person).count).to eq(1)
    end

    it "preserves an existing category assignment" do
      person = create_francisco!
      category = create_maintenance_category!
      assignment = UserTimeCategory.create!(user: person, time_category: category, hourly_rate_cents: 1_725)

      expect { migration.up }.not_to change(UserTimeCategory, :count)
      expect(assignment.reload.hourly_rate_cents).to eq(1_725)
    end

    it "refuses conflicting rates and completed snapshots" do
      person = create_francisco!
      category = create_maintenance_category!
      EmployeePayRate.create!(user: person, time_category: category, hourly_rate_cents: 1_500)
      expect { migration.up }.to raise_error(RuntimeError, /different maintenance rate/)

      EmployeePayRate.where(user: person, time_category: category).delete_all
      create(
        :time_entry, user: person, time_category: category, status: "completed",
        effective_rate_cents_snapshot: 1_500
      )
      expect { migration.up }.to raise_error(RuntimeError, /another snapshotted rate/)
    end

    it "cannot be rolled back after the verified rate may have been used" do
      expect { migration.down }.to raise_error(ActiveRecord::IrreversibleMigration)
    end
  end

  describe RecordVerifiedJeremiahPaymentHold do
    it "fails closed when the verified employee is absent" do
      allow(User).to receive(:find_by).with(id: described_class::USER_ID).and_return(nil)

      expect { described_class.new.up }.to raise_error(RuntimeError, /employee is missing/)
    end
  end

  describe ConnectVerifiedCornerstonePayrollAdmins do
    it "fails closed in production when both verified administrators are absent" do
      allow(User).to receive(:where).with(id: described_class::VERIFIED.keys).and_return(User.none)
      allow(Rails).to receive(:env).and_return(ActiveSupport::StringInquirer.new("production"))

      expect { described_class.new.up }.to raise_error(RuntimeError, /administrators are missing/)
    end
  end
end
