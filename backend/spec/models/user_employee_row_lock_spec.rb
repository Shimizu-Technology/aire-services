# frozen_string_literal: true

require "rails_helper"

# A batch approval holds employee row locks for its whole run. An employee in
# that batch who clocks in must get a fast answer: their punch times out on the
# employee lock after about 2 seconds, and the failure audit row that follows
# must not then wait for the batch to finish.
RSpec.describe "Employee row lock" do
  self.use_transactional_tests = false

  let!(:employee) { create(:user, :employee) }

  after do
    raise "test fixture teardown only" unless Rails.env.test?

    User.where(id: employee.id).delete_all
  end

  # Holds the employee lock in another connection, as a running batch does.
  def while_batch_holds_lock
    locked = Queue.new
    release = Queue.new
    holder = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        ActiveRecord::Base.transaction do
          User.lock_employees!([ employee.id ])
          locked << true
          release.pop
        end
      end
    end
    locked.pop
    yield
  ensure
    release << true
    holder&.join
  end

  it "lets an audit row for that employee through while the lock is held" do
    while_batch_holds_lock do
      ActiveRecord::Base.transaction do
        ActiveRecord::Base.connection.execute("SET LOCAL lock_timeout = '1s'")
        AuditLog.record!(action: "time_entry.clock_in_failed", actor: employee, subject_type: "User", subject_id: employee.id, outcome: "failed")
        raise ActiveRecord::Rollback
      end
    end
  end

  it "still makes a second writer for the same employee wait for the lock" do
    while_batch_holds_lock do
      expect do
        ActiveRecord::Base.transaction do
          ActiveRecord::Base.connection.execute("SET LOCAL lock_timeout = '300ms'")
          User.lock_employees!([ employee.id ])
        end
      end.to raise_error(ActiveRecord::LockWaitTimeout)
      expect do
        ActiveRecord::Base.transaction do
          ActiveRecord::Base.connection.execute("SET LOCAL lock_timeout = '300ms'")
          User.find(employee.id).lock_employee!
        end
      end.to raise_error(ActiveRecord::LockWaitTimeout)
    end
  end

  it "answers a punch from an employee in the batch quickly with a retryable message" do
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    while_batch_holds_lock do
      expect { TimeClockService.clock_in(user: User.find(employee.id)) }
        .to raise_error(TimeClockService::ClockError, /Nothing was saved\. Please try this clock action again/)
    end
    expect(Process.clock_gettime(Process::CLOCK_MONOTONIC) - started).to be < 5
  end
end
