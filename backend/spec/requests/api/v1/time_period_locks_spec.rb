# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Api::V1::TimePeriodLocks", type: :request do
  let(:admin) { create(:user, :admin) }
  let(:employee) { create(:user, :employee) }

  let(:auth_headers_for) do
    ->(user) { { "Authorization" => "Bearer test_token_#{user.id}" } }
  end

  def json
    JSON.parse(response.body, symbolize_names: true)
  end

  describe "GET /api/v1/time_period_locks" do
    let!(:lock) { create(:time_period_lock, locked_by: admin) }

    it "returns lock status for a week" do
      get "/api/v1/time_period_locks", params: { week: lock.start_date.iso8601 }, headers: auth_headers_for[employee]

      expect(response).to have_http_status(:ok)
      expect(json[:locked]).to eq(true)
      expect(json.dig(:lock, :id)).to eq(lock.id)
    end
  end

  describe "POST /api/v1/admin/time_period_locks" do
    it "allows admin to finalize week" do
      post "/api/v1/admin/time_period_locks",
           params: { week: Date.current.beginning_of_week(:sunday).iso8601, reason: "Payroll finalized" },
           headers: auth_headers_for[admin]

      expect(response).to have_http_status(:created)
      expect(json[:message]).to eq("Time period locked")
      expect(json.dig(:lock, :id)).to be_present
    end

    it "blocks non-admin" do
      post "/api/v1/admin/time_period_locks",
           params: { week: Date.current.beginning_of_week(:sunday).iso8601 },
           headers: auth_headers_for[employee]

      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "DELETE /api/v1/admin/time_period_locks/:id" do
    let!(:lock) { create(:time_period_lock, locked_by: admin) }

    it "allows admin to unlock" do
      delete "/api/v1/admin/time_period_locks/#{lock.id}", headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      expect(json[:message]).to eq("Time period unlocked")
      expect(TimePeriodLock.find_by(id: lock.id)).to be_nil
    end
  end
end
