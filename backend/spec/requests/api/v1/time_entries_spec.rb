# frozen_string_literal: true

require "rails_helper"

RSpec.describe "Api::V1::TimeEntries", type: :request do
  let(:admin) { create(:user, :admin) }
  let(:employee) { create(:user, :employee, first_name: "Alice", last_name: "Smith") }
  let(:other_employee) { create(:user, :employee, first_name: "Bob", last_name: "Jones") }
  let(:time_category) { create(:time_category, hourly_rate_cents: 4200) }

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
          description: "Created from spec",
          time_category_id: time_category.id
        }
      }
    end

    it "allows employee to create own entry" do
      post "/api/v1/time_entries", params: valid_params, headers: auth_headers_for[employee]

      expect(response).to have_http_status(:created)
      expect(json.dig(:time_entry, :user, :id)).to eq(employee.id)
      # Rates are hidden from employees; verify snapshot was stored via admin
      entry_id = json.dig(:time_entry, :id)
      get "/api/v1/time_entries/#{entry_id}", headers: auth_headers_for[admin]
      expect(json.dig(:time_entry, :effective_rate_cents)).to eq(4200)
      expect(json.dig(:time_entry, :effective_rate)).to eq(42.0)
    end

    it "keeps the manual entry rate stable after rates change later" do
      post "/api/v1/time_entries", params: valid_params, headers: auth_headers_for[employee]

      entry_id = json.dig(:time_entry, :id)
      create(:employee_pay_rate, user: employee, time_category: time_category, hourly_rate_cents: 6500)
      time_category.update!(hourly_rate_cents: 9000)

      get "/api/v1/time_entries/#{entry_id}", headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      expect(json.dig(:time_entry, :effective_rate_cents)).to eq(4200)
      expect(json.dig(:time_entry, :effective_rate)).to eq(42.0)
    end

    it "does not drift during approval updates after the snapshot is captured" do
      post "/api/v1/time_entries", params: valid_params, headers: auth_headers_for[employee]

      entry_id = json.dig(:time_entry, :id)
      create(:employee_pay_rate, user: employee, time_category: time_category, hourly_rate_cents: 6500)
      time_category.update!(hourly_rate_cents: 9000)

      post "/api/v1/time_entries/#{entry_id}/approve", headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      expect(json.dig(:time_entry, :approval_status)).to eq("approved")
      expect(json.dig(:time_entry, :effective_rate_cents)).to eq(4200)
      expect(json.dig(:time_entry, :effective_rate)).to eq(42.0)
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
      it "returns 404" do
        patch "/api/v1/time_entries/#{entry.id}",
              params: { time_entry: { description: "nope" } },
              headers: auth_headers_for[other_employee]

        expect(response).to have_http_status(:not_found)
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
      it "returns 404" do
        delete "/api/v1/time_entries/#{entry.id}",
               headers: auth_headers_for[other_employee]

        expect(response).to have_http_status(:not_found)
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

    it "returns 404 when employee tries to access another user's entry" do
      get "/api/v1/time_entries/#{entry.id}",
          headers: auth_headers_for[other_employee]

      expect(response).to have_http_status(:not_found)
      expect(json[:error]).to match(/not found/)
    end
  end

  describe "GET /api/v1/time_entries/pending_approvals" do
    let!(:cfi_employee) { create(:user, :employee, approval_group: "cfi", first_name: "Cfi", last_name: "User") }
    let!(:ops_employee) { create(:user, :employee, approval_group: "ops_maintenance", first_name: "Ops", last_name: "User") }
    let!(:unassigned_employee) { create(:user, :employee, approval_group: nil, first_name: "Unassigned", last_name: "User") }

    let!(:cfi_entry) { create(:time_entry, user: cfi_employee, approval_status: "pending") }
    let!(:ops_entry) { create(:time_entry, user: ops_employee, approval_status: "pending") }
    let!(:unassigned_entry) { create(:time_entry, user: unassigned_employee, approval_status: "pending") }

    it "returns all pending entries by default" do
      get "/api/v1/time_entries/pending_approvals", headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      ids = json[:pending_entries].map { |entry| entry[:id] }
      expect(ids).to include(cfi_entry.id, ops_entry.id, unassigned_entry.id)
    end

    it "filters pending entries by approval group" do
      get "/api/v1/time_entries/pending_approvals",
          params: { approval_group: "cfi" },
          headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      ids = json[:pending_entries].map { |entry| entry[:id] }
      expect(ids).to contain_exactly(cfi_entry.id)
      expect(json.dig(:pending_entries, 0, :user, :approval_group)).to eq("cfi")
    end

    it "filters pending entries for unassigned users" do
      get "/api/v1/time_entries/pending_approvals",
          params: { approval_group: "unassigned" },
          headers: auth_headers_for[admin]

      expect(response).to have_http_status(:ok)
      ids = json[:pending_entries].map { |entry| entry[:id] }
      expect(ids).to contain_exactly(unassigned_entry.id)
      expect(json.dig(:pending_entries, 0, :user, :approval_group)).to be_nil
    end
  end
end
