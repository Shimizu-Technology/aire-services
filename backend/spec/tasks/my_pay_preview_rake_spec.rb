# frozen_string_literal: true

require "rails_helper"
require "rake"

RSpec.describe "my_pay:preview" do
  let(:leon) { create(:user, :admin) }
  let(:chels) { create(:user, :admin) }
  let(:employee) { create(:user, :employee) }
  let(:task) { Rake::Task["my_pay:preview"] }

  before do
    Rails.application.load_tasks unless Rake::Task.task_defined?("my_pay:preview")
    task.reenable
  end

  def run_with(ids)
    previous = ENV.fetch("IDS", nil)
    ENV["IDS"] = ids
    task.reenable
    task.invoke
  ensure
    ENV["IDS"] = previous
  end

  it "sets active admins only and audits the change" do
    expect { run_with("#{chels.id}, #{leon.id}") }.to output("my_pay_preview_user_ids=#{[ leon.id, chels.id ].sort.join(',')}\n").to_stdout
    expect(Setting.my_pay_preview_user_ids).to contain_exactly(leon.id, chels.id)
    expect(AuditLog.find_by!(action: "setting.my_pay_preview_updated").metadata).to eq("previous_user_ids" => [], "user_ids" => [ leon.id, chels.id ].sort)
  end

  it "refuses employees and inactive admins without changing the list" do
    Setting.set("my_pay_preview_user_ids", leon.id.to_s)
    inactive = create(:user, :admin, is_active: false)

    expect { run_with(employee.id.to_s) }.to raise_error(ArgumentError, /non-admin user IDs: #{employee.id}/)
    expect { run_with(inactive.id.to_s) }.to raise_error(ArgumentError, /inactive/)
    expect { run_with("abc") }.to raise_error(ArgumentError, /positive integers/)
    expect(Setting.my_pay_preview_user_ids).to eq([ leon.id ])
  end

  it "clears the list with IDS=" do
    Setting.set("my_pay_preview_user_ids", leon.id.to_s)
    expect { run_with("") }.to output("my_pay_preview_user_ids=\n").to_stdout
    expect(Setting.my_pay_preview_allowed?(leon)).to be(false)
  end
end
