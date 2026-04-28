# frozen_string_literal: true

require "rails_helper"

RSpec.describe LeaveRequest, type: :model do
  describe "overlap validation" do
    it "serializes overlap checks through the associated user lock" do
      employee = create(:user, :employee)
      create(
        :leave_request,
        user: employee,
        status: "approved",
        start_date: Date.new(2026, 5, 20),
        end_date: Date.new(2026, 5, 22)
      )

      request = build(
        :leave_request,
        user: employee,
        start_date: Date.new(2026, 5, 21),
        end_date: Date.new(2026, 5, 23)
      )

      expect(employee).to receive(:with_lock).and_call_original

      expect(request).not_to be_valid
      expect(request.errors[:base]).to include("overlaps with another pending or approved leave request")
    end
  end
end
