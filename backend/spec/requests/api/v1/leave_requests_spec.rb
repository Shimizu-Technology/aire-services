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

  describe "GET /api/v1/leave_requests?scope=mine" do
    it "scopes supervisor leave before pagination even when another user is requested" do
      manager = create(:user, :manager)
      own = create(:leave_request, user: manager)
      create(:leave_request, user: other_employee)

      get "/api/v1/leave_requests", params: { scope: "mine", user_id: other_employee.id, per_page: 1 }, headers: auth_headers_for[manager]

      expect(response).to have_http_status(:ok)
      expect(json[:leave_requests].pluck(:id)).to eq([ own.id ])
      expect(json[:pagination]).to include(total_count: 1, total_pages: 1)
    end

    it "keeps employee reads scoped to themselves even without the mine flag" do
      own = create(:leave_request, user: employee)
      create(:leave_request, user: other_employee)

      get "/api/v1/leave_requests", params: { user_id: other_employee.id }, headers: auth_headers_for[employee]

      expect(json[:leave_requests].pluck(:id)).to eq([ own.id ])
    end
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
      expect(json.dig(:leave_request, :created_at)).to be_present
      expect(json.dig(:leave_request, :reviewed_at)).to be_nil
      expect(json.dig(:leave_request, :cancelled_at)).to be_nil

      audit_log = AuditLog.where(auditable: LeaveRequest.last).order(created_at: :desc).first
      expect(audit_log).to have_attributes(
        action: "leave_request.created",
        user_id: employee.id,
        metadata: { "leave_type" => "paid_time_off", "status" => "pending", "employee_id" => employee.id, "employee_name" => employee.full_name }
      )
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
      expect(json[:error]).to match(/already has other time off waiting or approved on these dates/i)
    end
  end

  describe "optional overlap filters" do
    let!(:left) { create(:leave_request, user: employee, start_date: "2026-08-01", end_date: "2026-08-05") }
    let!(:right) { create(:leave_request, user: employee, start_date: "2026-08-10", end_date: "2026-08-12") }
    let!(:outside) { create(:leave_request, user: other_employee, start_date: "2026-08-13", end_date: "2026-08-15") }

    it "includes both touching edges and still paginates" do
      get "/api/v1/leave_requests", params: { start_date: "2026-08-05", end_date: "2026-08-10", per_page: 1 }, headers: auth_headers_for[admin]
      expect(response).to have_http_status(:ok)
      expect(json[:pagination]).to include(total_count: 2, total_pages: 2)
      expect(json[:leave_requests].length).to eq(1)
      expect([ left.id, right.id ]).to include(json[:leave_requests].first[:id])
    end

    it "leaves the unfiltered response byte-for-byte unchanged for absent or blank filters" do
      get "/api/v1/leave_requests", headers: auth_headers_for[admin]
      unfiltered = response.body
      expect(json[:leave_requests].map { |row| row[:id] }).to contain_exactly(left.id, right.id, outside.id)
      get "/api/v1/leave_requests", params: { start_date: "", end_date: "" }, headers: auth_headers_for[admin]
      expect(response.body).to eq(unfiltered)
    end

    it "supports either optional edge and preserves employee scoping" do
      get "/api/v1/leave_requests", params: { start_date: "2026-08-10" }, headers: auth_headers_for[employee]
      expect(json[:leave_requests].map { |row| row[:id] }).to eq([ right.id ])
      get "/api/v1/leave_requests", params: { end_date: "2026-08-05" }, headers: auth_headers_for[employee]
      expect(json[:leave_requests].map { |row| row[:id] }).to eq([ left.id ])
    end

    [ { start_date: "not-a-date" }, { end_date: "2026-02-30" }, { start_date: "2026-08-10", end_date: "2026-08-01" } ].each do |filters|
      it "rejects invalid dates or reversed ranges: #{filters}" do
        get "/api/v1/leave_requests", params: filters, headers: auth_headers_for[admin]
        expect(response).to have_http_status(:unprocessable_entity)
        expect(json[:error]).to be_a(String)
      end
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
        start_date = Date.new(2027, 6, 1) + (index * 2)
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
      expect(json.dig(:leave_request, :reviewed_at)).to be_present
      expect(json.dig(:leave_request, :cancelled_by)).to be_nil
      expect(json.dig(:leave_request, :cancelled_at)).to be_nil

      audit_log = AuditLog.where(auditable: request_record).order(created_at: :desc).first
      expect(audit_log).to have_attributes(
        action: "leave_request.approved",
        user_id: admin.id,
        metadata: { "review_note" => "Approved", "employee_id" => request_record.user_id, "employee_name" => request_record.user.full_name }
      )
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
      expect(json[:error]).to match(/cannot approve or decline your own leave request/i)
      expect(own_request.reload.status).to eq("pending")
    end

    it "rejects a second review after the request is no longer pending" do
      post "/api/v1/leave_requests/#{request_record.id}/approve",
           params: { review_note: "Approved first" },
           headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)

      post "/api/v1/leave_requests/#{request_record.id}/decline",
           params: { review_note: "Declined second" },
           headers: auth_headers_for[admin]

      expect(response).to have_http_status(:unprocessable_entity)
      expect(json[:error]).to match(/Only pending leave requests can be reviewed/i)

      request_record.reload
      expect(request_record.status).to eq("approved")
      expect(request_record.review_note).to eq("Approved first")
    end
  end

  describe "POST /api/v1/leave_requests/:id/cancel" do
    let!(:request_record) { create(:leave_request, user: employee) }

    it "allows the owner to cancel a pending request" do
      post "/api/v1/leave_requests/#{request_record.id}/cancel", headers: auth_headers_for[employee]

      expect(response).to have_http_status(:ok)
      expect(json.dig(:leave_request, :status)).to eq("cancelled")
      expect(json.dig(:leave_request, :cancelled_by, :id)).to eq(employee.id)
      expect(json.dig(:leave_request, :cancelled_at)).to be_present
      expect(json.dig(:leave_request, :reviewed_by)).to be_nil
      expect(json.dig(:leave_request, :reviewed_at)).to be_nil

      audit_log = AuditLog.where(auditable: request_record).order(created_at: :desc).first
      expect(audit_log).to have_attributes(
        action: "leave_request.cancelled",
        user_id: employee.id,
        metadata: { "employee_id" => employee.id, "employee_name" => employee.full_name }
      )
    end

    it "blocks other employees" do
      post "/api/v1/leave_requests/#{request_record.id}/cancel", headers: auth_headers_for[other_employee]

      expect(response).to have_http_status(:not_found)
    end

    it "rejects cancel after the request is no longer pending" do
      post "/api/v1/leave_requests/#{request_record.id}/approve",
           params: { review_note: "Approved first" },
           headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)

      post "/api/v1/leave_requests/#{request_record.id}/cancel", headers: auth_headers_for[employee]

      expect(response).to have_http_status(:forbidden)
      expect(json[:error]).to match(/Only the request owner can cancel a pending leave request/i)

      request_record.reload
      expect(request_record.status).to eq("approved")
      expect(request_record.review_note).to eq("Approved first")
    end
  end
  describe "decline reason" do
    [ nil, "", "  \n " ].each do |note|
      it "refuses a blank reason #{note.inspect} without changing leave or writing a decision audit" do
        request_record = create(:leave_request, user: employee)
        expect do
          post "/api/v1/leave_requests/#{request_record.id}/decline",
               params: { review_note: note }, headers: auth_headers_for[admin]
        end.not_to change { AuditLog.where(action: "leave_request.declined").count }
        expect(response).to have_http_status(:unprocessable_entity)
        expect(json[:error]).to eq("Write a short reason to decline this leave request.")
        expect(request_record.reload.status).to eq("pending")
      end
    end

    it "saves the trimmed reason for the employee" do
      request_record = create(:leave_request, user: employee)
      post "/api/v1/leave_requests/#{request_record.id}/decline",
           params: { review_note: "  Coverage needed  " }, headers: auth_headers_for[admin]
      expect(response).to have_http_status(:ok)
      expect(request_record.reload).to have_attributes(status: "declined", review_note: "Coverage needed")
      get "/api/v1/leave_requests", headers: auth_headers_for[employee]
      expect(json[:leave_requests].find { |row| row[:id] == request_record.id }[:review_note]).to eq("Coverage needed")
    end
  end
end
