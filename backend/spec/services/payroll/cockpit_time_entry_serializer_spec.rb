# frozen_string_literal: true

require "rails_helper"

RSpec.describe Payroll::CockpitTimeEntrySerializer do
  describe "available time categories" do
    it "returns active assigned categories in case-insensitive name and id order" do
      employee = create(:user, :employee)
      first_alpha = create(:time_category, name: "Alpha", key: "alpha-first")
      last_alpha = create(:time_category, name: "alpha", key: "alpha-last")
      beta = create(:time_category, name: "Beta", key: "beta")
      inactive = create(:time_category, name: "Hidden", key: "hidden", is_active: false)
      employee.assigned_time_categories << [ last_alpha, first_alpha, beta, inactive ]
      entry = create(:time_entry, user: employee, time_category: beta)

      categories = described_class.new(entry).as_json.fetch(:available_time_categories)

      expect(categories).to eq([
        { id: first_alpha.id.to_s, key: "alpha-first", name: "Alpha" },
        { id: last_alpha.id.to_s, key: "alpha-last", name: "alpha" },
        { id: beta.id.to_s, key: "beta", name: "Beta" }
      ])
    end

    it "returns an empty category list when an entry has no employee" do
      entry = build_stubbed(:time_entry, user: nil)

      expect(described_class.new(entry).as_json.fetch(:available_time_categories)).to eq([])
    end
  end
end
