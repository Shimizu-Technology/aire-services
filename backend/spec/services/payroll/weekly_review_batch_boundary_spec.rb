require 'rails_helper'
RSpec.describe 'Independent pair-query boundary probe' do
  include ActiveSupport::Testing::TimeHelpers

  before { travel_to Time.utc(2026, 11, 16, 12) }
  after { travel_back }

  it 'does not count one overnight source twice across pair query batches' do
    zone=ActiveSupport::TimeZone['Pacific/Guam']
    employee=create(:user, :employee)
    category=create(:time_category)
    sunday=Date.new(2026, 10, 18)
    shift=->(date, hour, hours) do
      from=zone.local(date.year, date.month, date.day, hour)
      create(:time_entry, user: employee, time_category: category, work_date: date, entry_method: 'clock', status: 'completed', approval_status: nil,
        start_time: from, end_time: from+hours.hours, clock_in_at: from, clock_out_at: from+hours.hours)
    end
    overnight=shift.call(sunday-1, 22, 4)
    4.times { |i| shift.call(sunday+i, 8, 9) }
    friday=shift.call(sunday+5, 8, 2)
    # 249 empty distinct employee/week pairs place the two connected weeks on
    # opposite sides of the real 250-pair batch boundary.
    pairs=(1..249).map { |i| [ employee.id, sunday-i*14-7 ] }
    pairs << [ employee.id, sunday-7 ]
    pairs << [ employee.id, sunday ]
    context=Payroll::WeeklyOvertimeReview.send(:context_for, pairs.to_set)
    expect(context.count { |entry| entry.id == overnight.id }).to eq(1)
    split=Payroll::WeeklyOvertimeAllocator.call(context).fetch(friday.id)
    expect(split).to include(regular_hours: 2, overtime_hours: 0)
  end
end
