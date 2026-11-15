# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Undo leave cancellation", type: :request do
  let(:employee) { create(:user, :employee) }
  let(:request) { LeaveRequest.create!(user: employee, leave_type: "unpaid", start_date: Date.current + 3, end_date: Date.current + 4) }
  let(:headers) { { "Authorization" => "Bearer test_token_#{employee.id}" } }

  it "restores the same row and queue timestamp, refusing duplicate undo" do
    original_created_at = request.created_at
    post "/api/v1/leave_requests/#{request.id}/cancel", headers: headers
    expect(response).to have_http_status(:ok)
    expect do
      post "/api/v1/leave_requests/#{request.id}/undo_cancel", headers: headers
    end.not_to change(LeaveRequest, :count)
    expect(response).to have_http_status(:ok)
    expect(request.reload.status).to eq("pending")
    expect(request.created_at).to eq(original_created_at)
    post "/api/v1/leave_requests/#{request.id}/undo_cancel", headers: headers
    expect(response).to have_http_status(:unprocessable_entity)
  end
end
