# frozen_string_literal: true

require "rails_helper"
require Rails.root.join("db/migrate/20261110000000_allow_owner_and_manager_roles")
require Rails.root.join("db/migrate/20261110000100_move_my_pay_access_to_users")

RSpec.describe MoveMyPayAccessToUsers, type: :model do
  around do |example|
    ActiveRecord::Base.transaction(requires_new: true) do
      example.run
      raise ActiveRecord::Rollback
    end
  ensure
    User.reset_column_information
  end

  let(:migration) { described_class.new.tap { |m| m.verbose = false } }

  def reload_users
    User.reset_column_information
  end

  it "turns My Pay on for exactly the allowlisted people and retires both allowlists" do
    pilot = create(:user, :employee)
    admin_pilot = create(:user, :admin)
    bystander = create(:user, :employee)
    migration.down
    reload_users
    Setting.where(key: %w[my_pay_enabled_user_ids my_pay_preview_user_ids]).delete_all
    Setting.create!(key: "my_pay_enabled_user_ids", value: " #{pilot.id}, #{admin_pilot.id},999999,abc,#{pilot.id}")
    Setting.create!(key: "my_pay_preview_user_ids", value: admin_pilot.id.to_s)
    Setting.create!(key: "my_pay_enabled_for_all", value: "false")

    migration.up
    reload_users

    expect(User.where(my_pay_enabled: true).pluck(:id)).to contain_exactly(pilot.id, admin_pilot.id)
    expect(bystander.reload.my_pay_enabled).to be(false)
    expect(Setting.where(key: %w[my_pay_enabled_user_ids my_pay_preview_user_ids])).to be_empty
    expect(Setting.find_by!(key: "my_pay_enabled_for_all").value).to eq("false")
  end

  it "leaves everyone off when nothing was enabled, as in production today" do
    create_list(:user, 2, :employee)
    migration.down
    reload_users
    Setting.where(key: "my_pay_enabled_user_ids").delete_all

    migration.up
    reload_users

    expect(User.where(my_pay_enabled: true)).to be_empty
    expect(Setting.my_pay_enabled_for_all?).to be(false)
  end

  it "restores the allowlist from the column on rollback" do
    pilot = create(:user, :employee, my_pay_enabled: true)
    migration.down
    reload_users
    expect(Setting.find_by!(key: "my_pay_enabled_user_ids").value).to eq(pilot.id.to_s)
    expect(User.column_names).not_to include("my_pay_enabled")
    migration.up
    reload_users
  end
end

RSpec.describe AllowOwnerAndManagerRoles, type: :model do
  it "changes no one's role and accepts the new roles" do
    ActiveRecord::Base.transaction(requires_new: true) do
      users = [ create(:user, :admin), create(:user, :employee) ]
      migration = described_class.new.tap { |m| m.verbose = false }
      migration.down
      expect { migration.up }.not_to(change { users.map { |user| user.reload.role } })
      expect(create(:user, :owner).role).to eq("owner")
      expect(create(:user, :manager).role).to eq("manager")
      raise ActiveRecord::Rollback
    end
  end

  it "refuses to roll back while owners or managers exist" do
    ActiveRecord::Base.transaction(requires_new: true) do
      create(:user, :manager)
      expect { described_class.new.tap { |m| m.verbose = false }.down }.to raise_error(ActiveRecord::IrreversibleMigration)
      raise ActiveRecord::Rollback
    end
  end
end
