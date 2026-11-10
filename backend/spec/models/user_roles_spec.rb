# frozen_string_literal: true

require "rails_helper"

RSpec.describe User, "roles and capabilities", type: :model do
  let(:owner) { build_stubbed(:user, :owner) }
  let(:admin) { build_stubbed(:user, :admin) }
  let(:manager) { build_stubbed(:user, :manager) }
  let(:employee) { build_stubbed(:user, :employee) }

  # The capability matrix Leon decided on Nov 10, 2026.
  let(:expected) do
    {
      manage_settings: %w[owner admin],
      manage_users: %w[owner admin],
      manage_payroll: %w[owner admin],
      manage_schedules: %w[owner admin],
      manage_site: %w[owner admin],
      view_activity: %w[owner admin],
      preview_pay: %w[owner admin],
      manage_my_pay_access: %w[owner admin],
      approve_time: %w[owner admin manager],
      manage_team_time: %w[owner admin manager],
      approve_leave: %w[owner admin manager],
      unlock_kiosk: %w[owner admin manager],
      export_hours_reports: %w[owner admin manager],
      send_pay_statements: %w[owner admin manager]
    }.freeze
  end

  it "grants each capability to exactly the expected roles, through both the hash and the predicate" do
    expect(described_class::ROLE_CAPABILITIES.keys).to match_array(expected.keys)
    expected.each do |capability, roles|
      described_class::ROLES.each do |role|
        user = build_stubbed(:user, role: role)
        expect(user.capability?(capability)).to eq(roles.include?(role)), "#{role} #{capability}"
        expect(user.public_send("can_#{capability}?")).to eq(roles.include?(role)), "#{role} can_#{capability}?"
        expect(user.capabilities.fetch(capability)).to eq(roles.include?(role))
      end
    end
  end

  it "keeps owners able to do everything an admin can" do
    expect(owner.capabilities.select { |_, allowed| allowed }.keys).to include(*admin.capabilities.select { |_, allowed| allowed }.keys)
  end

  it "treats every role as staff and only owners and admins as administrators" do
    expect([ owner, admin, manager, employee ].map(&:staff?)).to all(be(true))
    expect([ owner, admin, manager, employee ].map(&:administrator?)).to eq([ true, true, false, false ])
    expect([ owner, admin, manager, employee ].map(&:supervisor?)).to eq([ true, true, true, false ])
    expect(described_class.administrators.to_sql).to include("'owner'", "'admin'")
  end

  describe "#can_assign_role?" do
    let(:other_owner) { build_stubbed(:user, :owner) }
    let(:other_admin) { build_stubbed(:user, :admin) }

    it "lets owners assign any role to anyone but themself" do
      [ other_owner, other_admin, manager, employee ].each do |target|
        expect(owner.roles_assignable_to(target)).to eq(described_class::ROLES)
      end
      expect(owner.roles_assignable_to(owner)).to eq([])
    end

    it "lets admins move only managers and employees, only between manager and employee" do
      expect(admin.roles_assignable_to(employee)).to eq(%w[manager employee])
      expect(admin.roles_assignable_to(manager)).to eq(%w[manager employee])
      expect(admin.roles_assignable_to(other_admin)).to eq([])
      expect(admin.roles_assignable_to(other_owner)).to eq([])
      expect(admin.can_assign_role?(described_class.new, "manager")).to be(true)
      expect(admin.can_assign_role?(described_class.new, "admin")).to be(false)
    end

    it "gives managers, employees and inactive admins nothing" do
      expect(manager.roles_assignable_to(employee)).to eq([])
      expect(employee.roles_assignable_to(employee)).to eq([])
      admin.is_active = false
      expect(admin.roles_assignable_to(employee)).to eq([])
    end

    it "judges an admin's edit by the target's saved role, not an unsaved change" do
      target = create(:user, :admin)
      target.role = "employee"
      expect(create(:user, :admin).can_assign_role?(target, "manager")).to be(false)
    end
  end

  describe "#can_change_access_for?" do
    it "reserves owners' and admins' termination and sign-in to owners" do
      expect(owner.can_change_access_for?(admin)).to be(true)
      expect(admin.can_change_access_for?(owner)).to be(false)
      expect(admin.can_change_access_for?(build_stubbed(:user, :admin))).to be(false)
      expect(admin.can_change_access_for?(manager)).to be(true)
      expect(manager.can_change_access_for?(employee)).to be(false)
    end
  end

  it "requires personal sign-in for owners, admins and managers" do
    %w[owner admin manager].each do |role|
      user = build(:user, :kiosk_only, role: role)
      expect(user).not_to be_valid
      expect(user.errors[:personal_access_enabled]).to include("must be enabled for #{role.pluralize}")
    end
    expect(build(:user, :kiosk_only, role: "employee")).to be_valid
  end

  it "rejects unknown roles in the model and the database" do
    expect(build(:user, role: "superuser")).not_to be_valid
    user = create(:user)
    expect { user.update_column(:role, "superuser") }.to raise_error(ActiveRecord::StatementInvalid, /check_valid_role/)
  end

  it "defaults My Pay off for new people" do
    expect(create(:user).my_pay_enabled).to be(false)
  end
end
