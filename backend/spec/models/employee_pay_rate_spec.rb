# frozen_string_literal: true

require "rails_helper"

RSpec.describe EmployeePayRate, type: :model do
  describe ".effective_rate_cents" do
    let(:user) { create(:user, :employee) }
    let(:time_category) { create(:time_category, hourly_rate_cents: 4200) }

    it "returns the category default when no employee override exists" do
      expect(described_class.effective_rate_cents(user.id, time_category.id)).to eq(4200)
    end

    it "prefers the employee override when present" do
      create(:employee_pay_rate, user: user, time_category: time_category, hourly_rate_cents: 5500)

      expect(described_class.effective_rate_cents(user.id, time_category.id)).to eq(5500)
      expect(described_class.effective_rate(user.id, time_category.id)).to eq(55.0)
    end
  end
end
