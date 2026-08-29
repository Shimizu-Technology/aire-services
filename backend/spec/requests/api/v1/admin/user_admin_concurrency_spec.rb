# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Admin access transition concurrency", type: :request do
  self.use_transactional_tests = false

  let(:email_suffix) { SecureRandom.hex(8) }
  let!(:first_admin) { create(:user, :admin, email: "concurrent-a-#{email_suffix}@example.test") }
  let!(:second_admin) { create(:user, :admin, email: "concurrent-b-#{email_suffix}@example.test") }

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
          session = ActionDispatch::Integration::Session.new(Rails.application)
          ready << true
          start.pop
          session.patch(
            "/api/v1/admin/users/#{target.id}",
            params: { is_active: false },
            headers: { "Authorization" => "Bearer test_token_#{actor.id}" }
          )
          session.response.status
        end
      end
    end

    2.times { ready.pop }
    2.times { start << true }
    statuses = requests.map(&:value)

    expect(statuses.count(200)).to eq(1)
    expect(User.admins.where(id: [ first_admin.id, second_admin.id ], is_active: true, personal_access_enabled: true).count).to eq(1)
  end
end
