# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Api::V1::TimeEntries", type: :request do
  let(:admin) { create(:user, :admin) }
  let(:employee) { create(:user, :employee, first_name: "Alice", last_name: "Smith") }
  let(:other_employee) { create(:user, :employee, first_name: "Bob", last_name: "Jones") }

  let(:auth_headers_for) do
    ->(user) { { "Authorization" => "Bearer test_token_#{user.id}" } }
  end

  # ── helpers ──────────────────────────────────────────────────────────
  def json
    JSON.parse(response.body, symbolize_names: true)
  end

  # ── CREATE ───────────────────────────────────────────────────────────
  describe "POST /api/v1/time_entries" do
    let(:valid_params) do
      {
        time_entry: {
          work_date: Date.current.iso8601,
          start_time: "09:00",
          end_time: "17:00",
          description: "Created from spec"
        }
      }
    end

    it "allows employee to create own entry" do
      post "/api/v1/time_entries", params: valid_params, headers: auth_headers_for[employee]

      expect(response).to have_http_status(:created)
      expect(json.dig(:time_entry, :user, :id)).to eq(employee.id)
    end

    it "allows admin to create entry for another staff user" do
      post "/api/v1/time_entries",
           params: valid_params.deep_merge(time_entry: { user_id: other_employee.id }),
           headers: auth_headers_for[admin]

      expect(response).to have_http_status(:created)
      expect(json.dig(:time_entry, :user, :id)).to eq(other_employee.id)
    end

    it "blocks non-admin from creating for another user" do
      post "/api/v1/time_entries",
           params: valid_params.deep_merge(time_entry: { user_id: other_employee.id }),
           headers: auth_headers_for[employee]

      expect(response).to have_http_status(:forbidden)
      expect(json[:error]).to eq("Only admins can create entries for other users")
    end
  end

  # ── UPDATE ───────────────────────────────────────────────────────────
  describe "PATCH /api/v1/time_entries/:id" do
    let!(:entry) { create(:time_entry, user: employee) }

    context "owner (employee) edits own entry" do
      it "succeeds" do
        patch "/api/v1/time_entries/#{entry.id}",
              params: { time_entry: { description: "updated" } },
              headers: auth_headers_for[employee]

        expect(response).to have_http_status(:ok)
        expect(json.dig(:time_entry, :description)).to eq("updated")
      end
    end

    context "admin edits another user's entry" do
      it "succeeds" do
        patch "/api/v1/time_entries/#{entry.id}",
              params: { time_entry: { description: "admin edit" } },
              headers: auth_headers_for[admin]

        expect(response).to have_http_status(:ok)
        expect(json.dig(:time_entry, :description)).to eq("admin edit")
      end
    end

    context "employee tries to edit another user's entry" do
      it "returns 403 with ownership error" do
        patch "/api/v1/time_entries/#{entry.id}",
              params: { time_entry: { description: "nope" } },
              headers: auth_headers_for[other_employee]

        expect(response).to have_http_status(:forbidden)
        expect(json[:error]).to eq("You can only edit your own time entries")
      end
    end

    context "locked entry" do
      let!(:locked_entry) { create(:time_entry, :locked, user: employee) }

      it "blocks owner from editing" do
        patch "/api/v1/time_entries/#{locked_entry.id}",
              params: { time_entry: { description: "nope" } },
              headers: auth_headers_for[employee]

        expect(response).to have_http_status(:forbidden)
        expect(json[:error]).to eq("This time entry is locked and cannot be edited")
      end

      it "blocks admin from editing" do
        patch "/api/v1/time_entries/#{locked_entry.id}",
              params: { time_entry: { description: "nope" } },
              headers: auth_headers_for[admin]

        expect(response).to have_http_status(:forbidden)
        expect(json[:error]).to eq("This time entry is locked and cannot be edited")
      end
    end
  end

  # ── DESTROY ──────────────────────────────────────────────────────────
  describe "DELETE /api/v1/time_entries/:id" do
    let!(:entry) { create(:time_entry, user: employee) }

    context "owner deletes own entry" do
      it "succeeds" do
        delete "/api/v1/time_entries/#{entry.id}",
               headers: auth_headers_for[employee]

        expect(response).to have_http_status(:no_content)
      end
    end

    context "admin deletes another user's entry" do
      it "succeeds" do
        delete "/api/v1/time_entries/#{entry.id}",
               headers: auth_headers_for[admin]

        expect(response).to have_http_status(:no_content)
      end
    end

    context "employee tries to delete another user's entry" do
      it "returns 403 with ownership error" do
        delete "/api/v1/time_entries/#{entry.id}",
               headers: auth_headers_for[other_employee]

        expect(response).to have_http_status(:forbidden)
        expect(json[:error]).to eq("You can only delete your own time entries")
      end
    end

    context "locked entry" do
      let!(:locked_entry) { create(:time_entry, :locked, user: employee) }

      it "blocks owner from deleting" do
        delete "/api/v1/time_entries/#{locked_entry.id}",
               headers: auth_headers_for[employee]

        expect(response).to have_http_status(:forbidden)
        expect(json[:error]).to eq("This time entry is locked and cannot be deleted")
      end

      it "blocks admin from deleting" do
        delete "/api/v1/time_entries/#{locked_entry.id}",
               headers: auth_headers_for[admin]

        expect(response).to have_http_status(:forbidden)
        expect(json[:error]).to eq("This time entry is locked and cannot be deleted")
      end
    end
  end

  # ── INDEX ────────────────────────────────────────────────────────────
  describe "GET /api/v1/time_entries" do
    let!(:emp_entry) { create(:time_entry, user: employee) }
    let!(:other_entry) { create(:time_entry, user: other_employee) }

    context "admin" do
      it "sees all entries" do
        get "/api/v1/time_entries", headers: auth_headers_for[admin]

        expect(response).to have_http_status(:ok)
        ids = json[:time_entries].map { |e| e[:id] }
        expect(ids).to include(emp_entry.id, other_entry.id)
      end
    end

    context "employee" do
      it "sees only own entries" do
        get "/api/v1/time_entries", headers: auth_headers_for[employee]

        expect(response).to have_http_status(:ok)
        ids = json[:time_entries].map { |e| e[:id] }
        expect(ids).to include(emp_entry.id)
        expect(ids).not_to include(other_entry.id)
      end
    end
  end

  # ── PERIOD LOCK BEHAVIOR ─────────────────────────────────────────────
  describe "period locks" do
    let(:week_start) { Date.current.beginning_of_week(:sunday) }
    let!(:period_lock) do
      create(:time_period_lock, start_date: week_start, end_date: week_start + 6.days, locked_by: admin)
    end

    it "blocks create inside locked week" do
      post "/api/v1/time_entries",
           params: {
             time_entry: {
               work_date: week_start.iso8601,
               start_time: "09:00",
               end_time: "17:00",
               description: "locked period create"
             }
           },
           headers: auth_headers_for[employee]

      expect(response).to have_http_status(:forbidden)
      expect(json[:error]).to eq("This time period is locked and cannot be modified")
    end

    it "blocks update inside locked week" do
      entry = create(:time_entry, user: employee, work_date: week_start)

      patch "/api/v1/time_entries/#{entry.id}",
            params: { time_entry: { description: "nope" } },
            headers: auth_headers_for[admin]

      expect(response).to have_http_status(:forbidden)
      expect(json[:error]).to eq("This time period is locked and cannot be modified")
    end

    it "blocks destroy inside locked week" do
      entry = create(:time_entry, user: employee, work_date: week_start)

      delete "/api/v1/time_entries/#{entry.id}",
             headers: auth_headers_for[admin]

      expect(response).to have_http_status(:forbidden)
      expect(json[:error]).to eq("This time period is locked and cannot be modified")
    end
  end

  # ── SHOW ─────────────────────────────────────────────────────────────
  describe "GET /api/v1/time_entries/:id" do
    let!(:entry) { create(:time_entry, user: employee) }

    it "includes locked_at in the response" do
      get "/api/v1/time_entries/#{entry.id}",
          headers: auth_headers_for[employee]

      expect(response).to have_http_status(:ok)
      expect(json[:time_entry]).to have_key(:locked_at)
      expect(json[:time_entry][:locked_at]).to be_nil
    end

    context "locked entry" do
      let!(:locked_entry) { create(:time_entry, :locked, user: employee) }

      it "returns locked_at timestamp" do
        get "/api/v1/time_entries/#{locked_entry.id}",
            headers: auth_headers_for[employee]

        expect(json[:time_entry][:locked_at]).to be_present
      end
    end

    it "includes user info with display_name" do
      get "/api/v1/time_entries/#{entry.id}",
          headers: auth_headers_for[employee]

      user_data = json[:time_entry][:user]
      expect(user_data[:id]).to eq(employee.id)
      expect(user_data[:display_name]).to eq(employee.display_name)
      expect(user_data[:full_name]).to eq(employee.full_name)
    end
  end
end
