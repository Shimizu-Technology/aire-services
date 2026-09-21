# frozen_string_literal: true

require "rails_helper"
require Rails.root.join("db/migrate/20260921020000_set_verified_francisco_maintenance_rate")
require Rails.root.join("db/migrate/20260921020100_record_verified_jeremiah_payment_hold")
require Rails.root.join("db/migrate/20260921020200_connect_verified_cornerstone_payroll_admins")
require Rails.root.join("db/migrate/20260921020300_record_verified_legacy_payment_holds")

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

  describe RecordVerifiedLegacyPaymentHolds do
    it "pins the exact owner-attested entries and fails closed when an identity is absent" do
      expect(described_class::ENTRIES.length).to eq(20)
      expect(described_class::ENTRIES.values.sum { |(_, _, hours)| hours.to_d }).to eq(113.84.to_d)
      expect(described_class::ENTRIES.values.map(&:first).uniq.sort).to eq(described_class::USERS.keys.sort)

      expect { described_class.new.up }.to raise_error(RuntimeError, /employees are missing/)
    end

    it "records each exact source entry once and removes it from future payroll" do
      create(:user, :admin, id: 1)
      users = described_class::USERS.to_h do |user_id, source_uuid|
        [ user_id, create(:user, :employee, id: user_id, payroll_integration_uuid: source_uuid) ]
      end
      category = create(:time_category)
      described_class::ENTRIES.each do |entry_id, (user_id, work_date, hours)|
        started_at = ActiveSupport::TimeZone["Pacific/Guam"].local(2000, 1, 1, 8)
        create(
          :time_entry, id: entry_id, user: users.fetch(user_id), time_category: category,
          work_date: Date.iso8601(work_date), start_time: started_at,
          end_time: started_at + hours.to_d.hours, hours: hours,
          status: "completed", entry_method: "clock", clock_source: "legacy",
          approval_status: "approved"
        )
      end

      expect { described_class.new.up }.to change(PayrollPaymentAttestation, :count).by(20)
      expect { described_class.new.up }.not_to change(PayrollPaymentAttestation, :count)
      expect(PayrollPaymentAttestation.pending_evidence.sum(:hours)).to eq(113.84.to_d)
      expect(
        Payroll::BatchBuilder.new(
          start_date: "2026-05-01", end_date: "2026-05-15",
          cutoff_at: Time.zone.parse("2026-09-21 17:00")
        ).call.dig(:summary, :total_hours)
      ).to eq(0.0)
    end

    it "cannot erase an owner attestation through a migration rollback" do
      expect { described_class.new.down }.to raise_error(ActiveRecord::IrreversibleMigration)
    end
  end
end
