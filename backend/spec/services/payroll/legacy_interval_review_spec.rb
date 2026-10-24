require 'rails_helper'

RSpec.describe 'PR 138 independent upgrade and boundary probes' do
  let(:zone) { ActiveSupport::TimeZone['Pacific/Guam'] }
  let(:sunday) { Date.new(2026, 10, 18) }
  let(:employee) { create(:user, :employee) }
  let(:admin) { create(:user, :admin) }
  let(:category) { create(:time_category) }
  def shift(date, hour, hours)
    from = zone.local(date.year, date.month, date.day, hour)
    create(:time_entry, user: employee, time_category: category, work_date: date, entry_method: 'clock', status: 'completed', approval_status: nil,
      start_time: from, end_time: from+hours.hours, clock_in_at: from, clock_out_at: from+hours.hours)
  end
  it 'requires renewed review when the upgrade increases an existing 6-hour approval to 8 hours' do
    shift(sunday-1, 22, 4)
    4.times { |i| shift(sunday+i, 8, 8) }
    shift(sunday+4, 8, 6)
    friday=shift(sunday+5, 8, 8)
    old = Payroll::WeeklyOvertimeAllocator.legacy_call(TimeEntry.where(user: employee).to_a).fetch(friday.id)
    expect(old).to include(regular_hours: 2, overtime_hours: 6)
    # Exactly the projection left by a populated upgrade: new additive columns
    # remain NULL, an existing explicit 6-hour decision remains approved.
    TimeEntry.where(user: employee).update_all(overtime_allocation_signature: nil, allocation_contract_version: nil, overtime_status: 'none')
    friday.reload.update_columns(overtime_status: 'approved', overtime_approved_at: Time.current, overtime_approved_by_id: admin.id)
    approved_at=friday.reload.overtime_approved_at
    unreviewed = Payroll::BatchBuilder.new(start_date: sunday, end_date: sunday+6).call
    expect(unreviewed[:rows].find { |row| row[:source_time_entry_id] == friday.id }&.dig(:overtime_hours).to_f).to eq(0)
    expect(Payroll::EmployeePeriodEvidence.new(user: employee).call[:totals][:pending_hours]).to eq(8)
    expect do
      Payroll::ManualAllocationRecorder.new(actor: admin).commit!(entry: friday,
        source_user_uuid: employee.payroll_integration_uuid, regular_hours: 0, overtime_hours: 8,
        external_pay_period_id: "upgrade-review", external_payroll_item_id: "unreviewed-eight",
        pay_date: BusinessDate.today.iso8601, reason: "Synthetic legacy approval must not grow")
    end.to raise_error(Payroll::ManualAllocationRecorder::Error, /exceed/)
    expect(PayrollManualAllocation.count).to eq(0)
    friday.update!(description: 'Unrelated post-upgrade note')
    result=Payroll::BatchBuilder.new(start_date: sunday, end_date: sunday+6).call
    line=result[:rows].find { |r| r[:source_time_entry_id]==friday.id }
    expect(line&.dig(:overtime_hours).to_f).to eq(0)
    expect(friday.reload.overtime_status).to eq('pending')
    expect(friday.overtime_approved_at).to be_nil
  end
  it 'releases an old frozen regular classification after its replacement overtime is explicitly approved' do
    from=zone.local(sunday.year, sunday.month, sunday.day, 8)
    earlier=create(:time_entry, user: employee, time_category: category, work_date: sunday, entry_method: 'clock', status: 'completed', approval_status: 'pending',
      start_time: from, end_time: from+8.hours, clock_in_at: from, clock_out_at: from+8.hours)
    weekdays=5.times.map { |i| shift(sunday+1+i, 8, 8) }
    friday=weekdays.last
    allow_any_instance_of(Payroll::BatchBuilder).to receive(:allocation_contract_version).and_return(nil)
    first=Payroll::BatchFinalizer.new(start_date: sunday, end_date: sunday+6, actor: admin).call
    expect(first.payroll_batch_entries.find_by!(source_time_entry_id: friday.id).regular_hours).to eq(8)
    frozen = first.attributes
    TimeEntry.where(user: employee).update_all(overtime_allocation_signature: nil, allocation_contract_version: nil)
    allow_any_instance_of(Payroll::BatchBuilder).to receive(:allocation_contract_version).and_call_original
    TimeClockService.approve_entry(entry: earlier.reload, approved_by: admin)
    expect(friday.reload.overtime_status).to eq('pending')
    TimeClockService.approve_overtime(entry: friday, approved_by: admin)
    result=Payroll::BatchBuilder.new(start_date: sunday+7, end_date: sunday+13).call
    rows=result[:rows].select { |r| r[:source_time_entry_id]==friday.id }
    holds=result[:exclusions].select { |r| r[:source_time_entry_id]==friday.id }
    expect(rows).to include(include(regular_hours: -8, overtime_hours: 8, total_hours: 0))
    expect(first.reload.attributes).to eq(frozen)
  end

  it 'preserves an unchanged legacy approval without stamping the current contract' do
    rows = 6.times.map { |i| shift(sunday + i, 8, 8) }
    friday = rows.last
    TimeEntry.where(user: employee).update_all(overtime_allocation_signature: nil, allocation_contract_version: nil)
    reviewed_at = Time.at(Time.current.to_i, 123_456_789, :nanosecond)
    friday.reload.update_columns(overtime_status: 'approved', overtime_approved_at: reviewed_at, overtime_approved_by_id: admin.id)
    # Compare the persisted approval, after PostgreSQL's microsecond serialization.
    reviewed_at = friday.reload.overtime_approved_at
    friday.update!(description: 'Legacy note leaves the reviewed split unchanged')
    expect(friday.reload).to have_attributes(overtime_status: 'approved', overtime_approved_at: reviewed_at, allocation_contract_version: nil)
    expect(Payroll::BatchBuilder.new(start_date: sunday, end_date: sunday + 6).call[:rows])
      .to include(include(source_time_entry_id: friday.id, overtime_hours: 8))
  end
end
