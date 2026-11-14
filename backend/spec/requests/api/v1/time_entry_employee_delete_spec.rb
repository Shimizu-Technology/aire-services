# frozen_string_literal: true

require "rails_helper"

# Employees may only take back time they added by hand that is still waiting
# and not locked by payroll. Supervisors keep deleting any shift.
RSpec.describe "Deleting time entries", type: :request do
  include ActiveSupport::Testing::TimeHelpers

  let(:zone) { ActiveSupport::TimeZone["Pacific/Guam"] }
  let(:employee) { create(:user, :employee, first_name: "Ethan", last_name: "Cruz") }
  let(:other) { create(:user, :employee) }
  let(:manager) { create(:user, :manager) }
  let(:refusal) { "You can only remove time you added that hasn't been approved yet. Ask your manager to change other shifts." }

  before { travel_to zone.local(2026, 11, 14, 21) }
  after { travel_back }

  def headers_for(user)
    { "Authorization" => "Bearer test_token_#{user.id}" }
  end

  def added(user = employee, **attributes)
    create(:time_entry, user: user, work_date: Date.new(2026, 11, 13), entry_method: "manual", approval_status: "pending", **attributes)
  end

  def remove(entry, as: employee)
    delete "/api/v1/time_entries/#{entry.id}", headers: headers_for(as)
  end

  it "lets an employee remove time they added that is still waiting, with an audit row" do
    entry = added

    expect { remove(entry) }.to change(TimeEntry, :count).by(-1)

    expect(response).to have_http_status(:no_content)
    expect(AuditLog.where(action: "time_entry.deleted", auditable_type: "TimeEntry", auditable_id: entry.id, actor_email: employee.email)).to exist
  end

  {
    "approved added time" => -> { added(approval_status: "approved") },
    "denied added time" => -> { added(approval_status: "denied") },
    "time a manager added for them" => -> { added(admin_override: true) },
    "a clocked shift" => lambda {
      start = zone.local(2026, 11, 13, 8)
      added(entry_method: "clock", clock_in_at: start, clock_out_at: start + 8.hours)
    }
  }.each do |label, build|
    it "refuses #{label}" do
      entry = instance_exec(&build)

      expect { remove(entry) }.not_to change(TimeEntry, :count)

      expect(response).to have_http_status(:forbidden)
      expect(JSON.parse(response.body)).to include("error" => refusal, "code" => "delete_not_allowed")
    end
  end

  it "refuses waiting added time in a finalized payroll period" do
    entry = added
    create(:payroll_batch, start_date: Date.new(2026, 11, 1), end_date: Date.new(2026, 11, 15),
                           cutoff_at: zone.local(2026, 11, 14, 17), finalized_at: zone.local(2026, 11, 14, 17))

    expect { remove(entry) }.not_to change(TimeEntry, :count)
    expect(response).to have_http_status(:forbidden)
  end

  it "refuses waiting added time after the period's published lock" do
    entry = added
    allow(Payroll::EntryCutoffWarnings).to receive(:call).and_return(Set[entry.id])

    expect { remove(entry) }.not_to change(TimeEntry, :count)
    expect(response).to have_http_status(:forbidden)
  end

  it "doesn't find someone else's time" do
    entry = added(other)

    expect { remove(entry) }.not_to change(TimeEntry, :count)
    expect(response).to have_http_status(:not_found)
  end

  it "refuses when an approval lands between the check and the delete" do
    entry = added
    allow_any_instance_of(TimeEntry).to receive(:lock!).and_wrap_original do |original, *args|
      TimeEntry.where(id: entry.id).update_all(approval_status: "approved")
      original.call(*args)
    end

    expect { remove(entry) }.not_to change(TimeEntry, :count)
    expect(response).to have_http_status(:forbidden)
    expect(AuditLog.where(action: "time_entry.deleted")).to be_empty
  end

  it "keeps a supervisor's delete rules: any shift, approved or clocked" do
    approved = added(approval_status: "approved")
    start = zone.local(2026, 11, 12, 8)
    clocked = added(entry_method: "clock", approval_status: nil, work_date: Date.new(2026, 11, 12),
                    clock_in_at: start, clock_out_at: start + 8.hours)

    expect { remove(approved, as: manager) }.to change(TimeEntry, :count).by(-1)
    expect(response).to have_http_status(:no_content)
    expect { remove(clocked, as: manager) }.to change(TimeEntry, :count).by(-1)
    expect(response).to have_http_status(:no_content)
  end
end
