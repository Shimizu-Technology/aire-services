# frozen_string_literal: true

require "rails_helper"
require "rake"

RSpec.describe "roles:assign" do
  let(:task) { Rake::Task["roles:assign"] }
  let!(:leon) { create(:user, :admin, first_name: "Leon") }
  let!(:chels) { create(:user, :admin, first_name: "Chels") }
  let!(:roke) { create(:user, :admin, first_name: "Roke") }

  before do
    Rails.application.load_tasks unless Rake::Task.task_defined?("roles:assign")
  end

  def run(env)
    keys = %w[ID ROLE OPERATOR BREAK_GLASS REASON]
    previous = keys.index_with { |key| ENV.fetch(key, nil) }
    keys.each { |key| ENV.delete(key) }
    env.each { |key, value| ENV[key] = value.to_s }
    task.reenable
    task.invoke
  ensure
    previous.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
  end

  it "makes the first owner, moves an admin to manager, and audits both with the operator" do
    expect { run("ID" => leon.id, "ROLE" => "owner", "OPERATOR" => "Lead") }
      .to output(/Changed #{leon.id} Leon User: admin -> owner.*#{leon.id} Leon User \(owner\)/m).to_stdout
    expect { run("ID" => roke.id, "ROLE" => "manager", "OPERATOR" => "Lead") }
      .to output(/Changed #{roke.id} Roke User: admin -> manager/).to_stdout

    expect([ leon, chels, roke ].map { |user| user.reload.role }).to eq(%w[owner admin manager])
    rows = AuditLog.where(action: "user.role_changed").order(:id)
    expect(rows.map { |row| [ row.auditable_id, row.changes_made["role"] ] }).to eq([ [ leon.id, %w[admin owner] ], [ roke.id, %w[admin manager] ] ])
    expect(rows.first).to have_attributes(user_id: nil, actor_kind: "system", source: "system")
    expect(rows.first.metadata).to include("operator" => "Lead", "via" => "roles:assign", "target_user_id" => leon.id)
  end

  it "is a no-op when the person already has the role" do
    expect { run("ID" => chels.id, "ROLE" => "admin", "OPERATOR" => "Lead") }.to output(/No change: #{chels.id} Chels User is already admin/).to_stdout
    expect(AuditLog.where(action: "user.role_changed")).to be_empty
  end

  it "refuses a second owner unless it's a break-glass with a reason" do
    expect { run("ID" => leon.id, "ROLE" => "owner", "OPERATOR" => "Lead") }.to output.to_stdout

    expect { run("ID" => chels.id, "ROLE" => "owner", "OPERATOR" => "Lead") }.to raise_error(SystemExit).and output(/active owner already exists/).to_stderr
    expect { run("ID" => chels.id, "ROLE" => "owner", "OPERATOR" => "Lead", "BREAK_GLASS" => "1") }.to raise_error(SystemExit).and output(/requires a REASON/).to_stderr
    expect(chels.reload.role).to eq("admin")

    expect { run("ID" => chels.id, "ROLE" => "owner", "OPERATOR" => "Lead", "BREAK_GLASS" => "1", "REASON" => "Leon locked out") }.to output(/admin -> owner/).to_stdout
    expect(AuditLog.where(action: "user.role_changed", auditable: chels).sole.metadata).to include("break_glass" => true, "reason" => "Leon locked out")
  end

  it "never removes the last active owner, even with break-glass" do
    expect { run("ID" => leon.id, "ROLE" => "owner", "OPERATOR" => "Lead") }.to output.to_stdout

    expect { run("ID" => leon.id, "ROLE" => "admin", "OPERATOR" => "Lead", "BREAK_GLASS" => "1", "REASON" => "test") }
      .to raise_error(SystemExit).and output(/at least one active owner/).to_stderr
    expect(leon.reload.role).to eq("owner")
  end

  it "never removes the last active owner-or-admin" do
    User.where(id: [ chels.id, roke.id ]).update_all(role: "employee")
    expect { run("ID" => leon.id, "ROLE" => "manager", "OPERATOR" => "Lead") }
      .to raise_error(SystemExit).and output(/at least one active admin/).to_stderr
  end

  it "requires an operator, a known role and a real, active user" do
    expect { run("ID" => leon.id, "ROLE" => "owner") }.to raise_error(SystemExit).and output(/OPERATOR/).to_stderr
    expect { run("ID" => leon.id, "ROLE" => "superuser", "OPERATOR" => "Lead") }.to raise_error(SystemExit).and output(/ROLE must be one of/).to_stderr
    expect { run("ID" => 999_999, "ROLE" => "manager", "OPERATOR" => "Lead") }.to raise_error(SystemExit).and output(/No user with ID/).to_stderr
    expect { run("ID" => "abc", "ROLE" => "manager", "OPERATOR" => "Lead") }.to raise_error(ArgumentError)
    inactive = create(:user, :employee, is_active: false)
    expect { run("ID" => inactive.id, "ROLE" => "manager", "OPERATOR" => "Lead") }.to raise_error(SystemExit).and output(/is not active/).to_stderr
    expect(AuditLog.where(action: "user.role_changed")).to be_empty
  end

  it "won't make a kiosk-only person a supervisor" do
    kiosk = create(:user, :employee, :kiosk_only, first_name: "Kiosk")
    expect { run("ID" => kiosk.id, "ROLE" => "manager", "OPERATOR" => "Lead") }
      .to raise_error(SystemExit).and output(/needs personal sign-in/).to_stderr
  end
end
