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

  after do
    User.where(id: [ first_admin.id, second_admin.id ]).destroy_all
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
          controller.params = ActionController::Parameters.new(id: target.id, is_active: false)
          controller.instance_variable_set(:@current_user, actor)
          controller.instance_variable_set(:@user, target)

          ready << true
          start.pop
          controller.update

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
end
