# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Api::V1::LeaveRequests", type: :request do
  let(:admin) { create(:user, :admin) }
  let(:employee) { create(:user, :employee, first_name: "Alice", last_name: "Smith") }
  let(:other_employee) { create(:user, :employee, first_name: "Bob", last_name: "Jones") }

  let(:auth_headers_for) do
    ->(user) { { "Authorization" => "Bearer test_token_#{user.id}" } }
  end

  def json
    JSON.parse(response.body, symbolize_names: true)
  end

  describe "POST /api/v1/leave_requests" do
    it "allows staff to submit a leave request" do
      post "/api/v1/leave_requests",
           params: {
             leave_request: {
               leave_type: "paid_time_off",
               start_date: "2026-05-20",
               end_date: "2026-05-22",
               reason: "Family travel"
             }
           },
           headers: auth_headers_for[employee]

      expect(response).to have_http_status(:created)
      expect(json.dig(:leave_request, :status)).to eq("pending")
      expect(json.dig(:leave_request, :user, :id)).to eq(employee.id)
      expect(json.dig(:leave_request, :total_days)).to eq(3)
    end

    it "rejects overlapping pending or approved requests for the same employee" do
      create(:leave_request, user: employee, start_date: Date.new(2026, 5, 20), end_date: Date.new(2026, 5, 22), status: "approved")

      post "/api/v1/leave_requests",
           params: {
             leave_request: {
               leave_type: "paid_time_off",
               start_date: "2026-05-21",
               end_date: "2026-05-23",
               reason: "Overlap attempt"
             }
           },
           headers: auth_headers_for[employee]

      expect(response).to have_http_status(:unprocessable_entity)
      expect(json[:error]).to match(/overlaps with another pending or approved leave request/i)
    end
  end

  describe "GET /api/v1/leave_requests" do
    let!(:own_request) { create(:leave_request, user: employee) }
    let!(:other_request) { create(:leave_request, user: other_employee) }

    it "shows employees only their own requests" do
      get "/api/v1/leave_requests", headers: auth_headers_for[employee]

      expect(response).to have_http_status(:ok)
      expect(json[:leave_requests].map { |request| request.dig(:user, :id) }).to eq([ employee.id ])
    end

    it "shows admins all requests" do
      get "/api/v1/leave_requests", headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      expect(json[:leave_requests].map { |request| request.dig(:user, :id) }).to include(employee.id, other_employee.id)
    end

    it "paginates the admin index" do
      30.times do |index|
        start_date = Date.new(2026, 6, 1) + (index * 2)
        create(
          :leave_request,
          user: employee,
          start_date: start_date,
          end_date: start_date
        )
      end

      get "/api/v1/leave_requests",
          params: { page: 2, per_page: 10 },
          headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      expect(json[:leave_requests].length).to eq(10)
      expect(json.dig(:pagination, :current_page)).to eq(2)
      expect(json.dig(:pagination, :per_page)).to eq(10)
      expect(json.dig(:pagination, :total_count)).to eq(32)
      expect(json.dig(:pagination, :total_pages)).to eq(4)
    end

    it "lets admins filter reviewed requests separately from pending approvals" do
      pending_request = create(:leave_request, user: employee, status: "pending", start_date: Date.new(2026, 7, 1), end_date: Date.new(2026, 7, 2))
      approved_request = create(:leave_request, user: employee, status: "approved", start_date: Date.new(2026, 7, 10), end_date: Date.new(2026, 7, 11))
      declined_request = create(:leave_request, user: other_employee, status: "declined", start_date: Date.new(2026, 7, 20), end_date: Date.new(2026, 7, 21))

      get "/api/v1/leave_requests",
          params: { status: "reviewed" },
          headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      ids = json[:leave_requests].map { |request| request.fetch(:id) }
      expect(ids).to include(approved_request.id, declined_request.id)
      expect(ids).not_to include(pending_request.id)
    end
  end

  describe "POST /api/v1/leave_requests/:id/approve" do
    let!(:request_record) { create(:leave_request, user: employee) }

    it "allows admins to approve a pending request" do
      post "/api/v1/leave_requests/#{request_record.id}/approve",
           params: { review_note: "Approved" },
           headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      expect(json.dig(:leave_request, :status)).to eq("approved")
      expect(json.dig(:leave_request, :review_note)).to eq("Approved")
      expect(json.dig(:leave_request, :reviewed_by, :id)).to eq(admin.id)
    end

    it "blocks non-admin review" do
      post "/api/v1/leave_requests/#{request_record.id}/approve", headers: auth_headers_for[employee]

      expect(response).to have_http_status(:forbidden)
    end

    it "does not allow admins to approve their own leave request" do
      own_request = create(:leave_request, user: admin)

      post "/api/v1/leave_requests/#{own_request.id}/approve",
           params: { review_note: "Self-approved" },
           headers: auth_headers_for[admin]

      expect(response).to have_http_status(:unprocessable_entity)
      expect(json[:error]).to match(/cannot approve or decline their own leave requests/i)
      expect(own_request.reload.status).to eq("pending")
    end
  end

  describe "POST /api/v1/leave_requests/:id/cancel" do
    let!(:request_record) { create(:leave_request, user: employee) }

    it "allows the owner to cancel a pending request" do
      post "/api/v1/leave_requests/#{request_record.id}/cancel", headers: auth_headers_for[employee]

      expect(response).to have_http_status(:ok)
      expect(json.dig(:leave_request, :status)).to eq("cancelled")
    end

    it "blocks other employees" do
      post "/api/v1/leave_requests/#{request_record.id}/cancel", headers: auth_headers_for[other_employee]

      expect(response).to have_http_status(:not_found)
    end
  end
end
