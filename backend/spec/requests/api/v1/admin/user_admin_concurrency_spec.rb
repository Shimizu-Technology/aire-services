# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Admin access transition concurrency", type: :request do
  self.use_transactional_tests = false

  let(:email_suffix) { SecureRandom.hex(8) }
  let!(:first_admin) do
    create(:user, :admin, email: "concurrent-a-#{email_suffix}@example.test", clerk_id: "concurrent_a_#{email_suffix}")
  end
  let!(:second_admin) do
    create(:user, :admin, email: "concurrent-b-#{email_suffix}@example.test", clerk_id: "concurrent_b_#{email_suffix}")
  end
  let!(:employee) do
    create(:user, :employee, email: "concurrent-employee-#{email_suffix}@example.test", clerk_id: "concurrent_employee_#{email_suffix}")
  end

  before do
    allow(AuditLog).to receive(:record!)
  end

  after do
    TimeEntry.where(user_id: employee.id).delete_all
    UserTimeCategory.where(user_id: employee.id).delete_all
    User.where(id: [ first_admin.id, second_admin.id, employee.id ]).destroy_all
    @clock_in_category&.destroy!
  end

  it "serializes competing transitions so one sign-in-capable admin remains" do
    ready = Queue.new
    start = Queue.new

    requests = [
      [ first_admin, second_admin ],
      [ second_admin, first_admin ]
    ].map do |actor, target|
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          # Pre-authenticate both requests so the test reaches the competing
          # transition path instead of racing in the authentication callback.
          controller = Api::V1::Admin::UsersController.new
          controller.request = ActionController::TestRequest.create(controller.class)
          controller.response = ActionDispatch::TestResponse.new
          controller.instance_variable_set(:@_response_body, nil)
          controller.params = ActionController::Parameters.new(id: target.id, effective_on: Date.current.iso8601)
          controller.instance_variable_set(:@current_user, actor)
          controller.instance_variable_set(:@user, target)

          ready << true
          start.pop
          controller.terminate

          controller.response.status
        end
      end
    end

    2.times { ready.pop }
    2.times { start << true }
    statuses = requests.map(&:value)

    expect(statuses).to contain_exactly(200, 422)
    expect(User.admins.where(id: [ first_admin.id, second_admin.id ], is_active: true, personal_access_enabled: true).count).to eq(1)
  end

  it "records exactly one termination when two admins target the same employee" do
    ready = Queue.new
    start = Queue.new

    requests = [ first_admin, second_admin ].map.with_index do |actor, index|
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          controller = Api::V1::Admin::UsersController.new
          controller.request = ActionController::TestRequest.create(controller.class)
          controller.response = ActionDispatch::TestResponse.new
          controller.instance_variable_set(:@_response_body, nil)
          controller.params = ActionController::Parameters.new(
            id: employee.id,
            effective_on: Date.current.iso8601,
            reason: "Concurrent reason #{index + 1}"
          )
          controller.instance_variable_set(:@current_user, actor)
          controller.instance_variable_set(:@user, User.find(employee.id))

          ready << true
          start.pop
          controller.terminate

          controller.response.status
        end
      end
    end

    2.times { ready.pop }
    2.times { start << true }

    expect(requests.map(&:value)).to contain_exactly(200, 422)
    expect(AuditLog).to have_received(:record!).with(hash_including(action: "admin.users.terminate", auditable: employee)).once
    expect(employee.reload).to be_terminated
    expect(employee.termination_reason).to match(/Concurrent reason [12]/)
  end

  it "serializes termination with clock-in so an inactive employee never has an open shift" do
    Setting.set("schedule_required_for_clock_in", "false")
    @clock_in_category = create(:time_category)
    UserTimeCategory.create!(user: employee, time_category: @clock_in_category)
    ready = Queue.new
    start = Queue.new

    terminate_request = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        controller = Api::V1::Admin::UsersController.new
        controller.request = ActionController::TestRequest.create(controller.class)
        controller.response = ActionDispatch::TestResponse.new
        controller.instance_variable_set(:@_response_body, nil)
        controller.params = ActionController::Parameters.new(id: employee.id, effective_on: Date.current.iso8601)
        controller.instance_variable_set(:@current_user, first_admin)
        controller.instance_variable_set(:@user, User.find(employee.id))

        ready << true
        start.pop
        controller.terminate
        controller.response.status
      end
    end

    clock_in_request = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        ready << true
        start.pop
        begin
          TimeClockService.clock_in(
            user: User.find(employee.id),
            admin_override_by: second_admin,
            time_category_id: @clock_in_category.id,
            clock_source: "admin"
          )
          :created
        rescue TimeClockService::ClockError
          :rejected
        end
      end
    end

    2.times { ready.pop }
    2.times { start << true }
    outcomes = [ terminate_request.value, clock_in_request.value ]
    employee.reload

    expect(outcomes).to satisfy do |termination_status, clock_in_status|
      [ termination_status, clock_in_status ].in?([ [ 200, :rejected ], [ 422, :created ] ])
    end
    expect(employee.is_active? && employee.time_entries.where(status: %w[clocked_in on_break]).exists?).to eq(outcomes == [ 422, :created ])
    expect(employee.terminated? && employee.time_entries.where(status: %w[clocked_in on_break]).exists?).to be(false)
  end
end
