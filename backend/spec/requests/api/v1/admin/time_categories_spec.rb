# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Api::V1::Admin::TimeCategories", type: :request do
  let(:admin) { create(:user, :admin) }
  let(:employee) { create(:user, :employee) }

  let(:auth_headers_for) do
    ->(user) { { "Authorization" => "Bearer test_token_#{user.id}" } }
  end

  def json
    JSON.parse(response.body, symbolize_names: true)
  end

  describe "GET /api/v1/admin/time_categories" do
    it "returns usage counts without changing the shape of the response" do
      category = create(:time_category)
      create(:time_entry, user: employee, time_category: category)
      create(:employee_pay_rate, user: employee, time_category: category)

      get "/api/v1/admin/time_categories", headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      payload = json.fetch(:time_categories).find { |entry| entry.fetch(:id) == category.id }
      expect(payload).to include(
        time_entries_count: 1,
        employee_pay_rates_count: 1,
        deletable: false
      )
    end
  end

  describe "DELETE /api/v1/admin/time_categories/:id" do
    it "permanently deletes an unused category" do
      category = create(:time_category)

      expect do
        delete "/api/v1/admin/time_categories/#{category.id}", headers: auth_headers_for[admin]
      end.to change(TimeCategory, :count).by(-1)

      expect(response).to have_http_status(:no_content)
      expect(TimeCategory.exists?(category.id)).to eq(false)
    end

    it "blocks deleting a category with time entry history" do
      category = create(:time_category)
      create(:time_entry, user: employee, time_category: category)

      expect do
        delete "/api/v1/admin/time_categories/#{category.id}", headers: auth_headers_for[admin]
      end.not_to change(TimeCategory, :count)

      expect(response).to have_http_status(:unprocessable_entity)
      expect(json[:error]).to match(/Deactivate it instead of deleting it/i)
      expect(category.reload.is_active).to eq(true)
    end

    it "blocks deleting a category with employee pay rates" do
      category = create(:time_category)
      create(:employee_pay_rate, user: employee, time_category: category)

      expect do
        delete "/api/v1/admin/time_categories/#{category.id}", headers: auth_headers_for[admin]
      end.not_to change(TimeCategory, :count)

      expect(response).to have_http_status(:unprocessable_entity)
      expect(json[:error]).to match(/Deactivate it instead of deleting it/i)
    end

    it "returns a validation-style response if destroy races with a new dependency" do
      category = create(:time_category)

      allow_any_instance_of(TimeCategory).to receive(:destroy!).and_raise(
        ActiveRecord::RecordNotDestroyed.new("cannot destroy", category)
      )

      expect do
        delete "/api/v1/admin/time_categories/#{category.id}", headers: auth_headers_for[admin]
      end.not_to change(TimeCategory, :count)

      expect(response).to have_http_status(:unprocessable_entity)
      expect(json[:error]).to match(/Deactivate it instead of deleting it/i)
    end
  end
end
