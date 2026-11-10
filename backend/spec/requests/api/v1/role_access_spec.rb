# frozen_string_literal: true

require "rails_helper"

# One place that walks every role across the endpoints whose access the role
# decides. Detailed behavior of each endpoint lives in its own spec.
RSpec.describe "Role-based access", type: :request do
  let(:owner) { create(:user, :owner) }
  let(:admin) { create(:user, :admin) }
  let(:manager) { create(:user, :manager) }
  let(:employee) { create(:user, :employee) }
  let(:worker) { create(:user, :employee, first_name: "Ana") }
  let(:category) { create(:time_category) }

  def headers_for(user)
    { "Authorization" => "Bearer test_token_#{user.id}" }
  end

  def json
    response.parsed_body
  end

  before { worker.user_time_categories.find_or_create_by!(time_category: category) }

  describe "the day-to-day time workflow" do
    { owner: :owner, admin: :admin, manager: :manager }.each do |label, role|
      context "as #{label}" do
        let(:actor) { public_send(role) }

        it "works the approval queue: list, approve, deny, approve and deny overtime, bulk approve" do
          get "/api/v1/time_entries/pending_approvals", headers: headers_for(actor)
          expect(response).to have_http_status(:ok)

          pending = create(:time_entry, user: worker, time_category: category, approval_status: "pending")
          post "/api/v1/time_entries/#{pending.id}/approve", params: { note: "Looks right" }, headers: headers_for(actor)
          expect(response).to have_http_status(:ok)
          expect(pending.reload).to have_attributes(approval_status: "approved", approved_by_id: actor.id)

          denied = create(:time_entry, user: worker, time_category: category, approval_status: "pending")
          post "/api/v1/time_entries/#{denied.id}/deny", params: { note: "Not scheduled" }, headers: headers_for(actor)
          expect(response).to have_http_status(:ok)
          expect(denied.reload.approval_status).to eq("denied")

          overtime = create(:time_entry, user: worker, time_category: category, approval_status: "approved", overtime_status: "pending")
          post "/api/v1/time_entries/#{overtime.id}/deny_overtime", params: { note: "Not authorized" }, headers: headers_for(actor)
          expect(response).to have_http_status(:ok)
          expect(overtime.reload.overtime_status).to eq("denied")

          both = create(:time_entry, user: worker, time_category: category, approval_status: "pending")
          post "/api/v1/time_entries/bulk_approve", params: { entry_ids: [ both.id ] }, headers: headers_for(actor)
          expect(response).to have_http_status(:ok)
          expect(both.reload.approval_status).to eq("approved")
        end

        it "sees the team's time and creates, corrects and deletes it" do
          entry = create(:time_entry, user: worker, time_category: category)
          get "/api/v1/time_entries", params: { user_id: worker.id }, headers: headers_for(actor)
          expect(response).to have_http_status(:ok)
          expect(json.fetch("time_entries").map { |row| row["id"] }).to include(entry.id)

          post "/api/v1/time_entries",
               params: { time_entry: { user_id: worker.id, work_date: Date.current.iso8601, start_time: "09:00", end_time: "12:00", description: "Logged for Ana", time_category_id: category.id } },
               headers: headers_for(actor)
          expect(response).to have_http_status(:created)
          expect(json.dig("time_entry", "user", "id")).to eq(worker.id)
          expect(json.dig("time_entry", "approval_status")).to eq("pending")

          patch "/api/v1/time_entries/#{entry.id}", params: { time_entry: { description: "Corrected" } }, headers: headers_for(actor)
          expect(response).to have_http_status(:ok)
          expect(entry.reload.description).to eq("Corrected")

          delete "/api/v1/time_entries/#{entry.id}", headers: headers_for(actor)
          expect(response).to have_http_status(:no_content)

          get "/api/v1/time_categories", headers: headers_for(actor)
          expect(json.fetch("time_categories").map { |row| row["id"] }).to include(category.id)
          get "/api/v1/time_entries/whos_working", headers: headers_for(actor)
          expect(response).to have_http_status(:ok)
        end

        it "approves and declines leave" do
          approve = create(:leave_request, user: worker)
          post "/api/v1/leave_requests/#{approve.id}/approve", params: { review_note: "Enjoy" }, headers: headers_for(actor)
          expect(response).to have_http_status(:ok)
          expect(approve.reload.status).to eq("approved")

          decline = create(:leave_request, user: worker, start_date: 20.days.from_now.to_date, end_date: 21.days.from_now.to_date)
          post "/api/v1/leave_requests/#{decline.id}/decline", params: { review_note: "Short-staffed" }, headers: headers_for(actor)
          expect(response).to have_http_status(:ok)
          expect(decline.reload.status).to eq("declined")
        end

        it "unlocks the kiosk, and the unlock token verifies" do
          post "/api/v1/admin/kiosk_session", headers: headers_for(actor)
          expect(response).to have_http_status(:created)
          expect(AireKioskAccessToken.admin_from_token(json.fetch("kiosk_access_token"))).to eq(actor)
        end

        it "exports hours reports" do
          get "/api/v1/admin/hours_report", params: { start_date: Date.current.beginning_of_month.iso8601, end_date: Date.current.iso8601 }, headers: headers_for(actor)
          expect(response).to have_http_status(:ok)
          get "/api/v1/admin/hours_report/summary_csv", params: { start_date: Date.current.beginning_of_month.iso8601, end_date: Date.current.iso8601 }, headers: headers_for(actor)
          expect(response).to have_http_status(:ok)
        end
      end
    end

    it "keeps every one of those refused for an employee" do
      entry = create(:time_entry, user: worker, time_category: category, approval_status: "pending")
      leave = create(:leave_request, user: worker)

      get "/api/v1/time_entries/pending_approvals", headers: headers_for(employee)
      expect(response).to have_http_status(:forbidden)
      %w[approve deny approve_overtime deny_overtime].each do |action|
        post "/api/v1/time_entries/#{entry.id}/#{action}", params: { note: "x" }, headers: headers_for(employee)
        expect(response).to have_http_status(:not_found).or have_http_status(:forbidden)
      end
      post "/api/v1/time_entries/bulk_approve", params: { entry_ids: [ entry.id ] }, headers: headers_for(employee)
      expect(response).to have_http_status(:forbidden)
      post "/api/v1/time_entries",
           params: { time_entry: { user_id: worker.id, work_date: Date.current.iso8601, start_time: "09:00", end_time: "12:00", time_category_id: category.id } },
           headers: headers_for(employee)
      expect(response).to have_http_status(:forbidden)
      get "/api/v1/time_entries", params: { user_id: worker.id }, headers: headers_for(employee)
      expect(json.fetch("time_entries")).to be_empty
      post "/api/v1/leave_requests/#{leave.id}/approve", headers: headers_for(employee)
      expect(response).to have_http_status(:not_found).or have_http_status(:forbidden)
      post "/api/v1/admin/kiosk_session", headers: headers_for(employee)
      expect(response).to have_http_status(:forbidden)
      get "/api/v1/admin/hours_report", headers: headers_for(employee)
      expect(response).to have_http_status(:forbidden)
      get "/api/v1/time_entries/whos_working", headers: headers_for(employee)
      expect(response).to have_http_status(:forbidden)
      expect(entry.reload.approval_status).to eq("pending")
      expect(leave.reload.status).to eq("pending")
    end
  end

  describe "owner and admin areas" do
    let(:admin_only_requests) do
      [
        [ :get, "/api/v1/admin/settings" ],
        [ :patch, "/api/v1/admin/settings" ],
        [ :get, "/api/v1/admin/users" ],
        [ :post, "/api/v1/admin/users" ],
        [ :patch, "/api/v1/admin/users/#{worker.id}" ],
        [ :post, "/api/v1/admin/users/#{worker.id}/terminate" ],
        [ :get, "/api/v1/admin/my_pay_access" ],
        [ :patch, "/api/v1/admin/my_pay_access" ],
        [ :patch, "/api/v1/admin/users/#{worker.id}/my_pay" ],
        [ :get, "/api/v1/admin/users/#{worker.id}/periods" ],
        [ :get, "/api/v1/admin/payroll_batches" ],
        [ :post, "/api/v1/admin/payroll_batches/preview" ],
        [ :get, "/api/v1/admin/time_categories" ],
        [ :get, "/api/v1/admin/audit_logs" ],
        [ :get, "/api/v1/admin/site-media" ],
        [ :get, "/api/v1/admin/contact_settings" ],
        [ :post, "/api/v1/schedules" ],
        [ :get, "/api/v1/payroll/account_link_sessions/not-a-real-token" ],
        [ :get, "/api/v1/my_pay/preview/workers" ],
        [ :get, "/api/v1/my_pay/preview/workers/#{worker.id}/statements" ]
      ]
    end

    it "refuses a manager everywhere with 403 and changes nothing" do
      [ manager, worker ].each(&:reload)
      counts = -> { [ Setting.count, Setting.maximum(:updated_at), Schedule.count, PayrollBatch.count, User.count ] }
      before = counts.call
      admin_only_requests.each do |verb, path|
        public_send(verb, path, params: { enabled_for_all: true, enabled: true, role: "admin" }, headers: headers_for(manager))
        expect(response).to have_http_status(:forbidden), "#{verb.upcase} #{path} returned #{response.status}"
      end
      expect(worker.reload).to have_attributes(role: "employee", my_pay_enabled: false, is_active: true)
      expect(Setting.my_pay_enabled_for_all?).to be(false)
      expect(counts.call).to eq(before)
    end

    it "refuses an employee everywhere with 403" do
      admin_only_requests.each do |verb, path|
        public_send(verb, path, headers: headers_for(employee))
        expect(response).to have_http_status(:forbidden), "#{verb.upcase} #{path} returned #{response.status}"
      end
    end

    it "opens them to owners and admins" do
      [ owner, admin ].each do |actor|
        %w[/api/v1/admin/settings /api/v1/admin/users /api/v1/admin/my_pay_access /api/v1/admin/payroll_batches
           /api/v1/admin/time_categories /api/v1/admin/audit_logs /api/v1/my_pay/preview/workers].each do |path|
          get path, headers: headers_for(actor)
          expect(response).to have_http_status(:ok), "#{actor.role} GET #{path} returned #{response.status}"
        end
      end
    end

    it "keeps pay-statement previews to owners and admins in the auth payload" do
      { owner => true, admin => true, manager => false, employee => false }.each do |user, allowed|
        get "/api/v1/auth/me", headers: headers_for(user)
        expect(json.dig("user", "my_pay_preview_enabled")).to be(allowed)
        expect(json.dig("user", "capabilities", "preview_pay")).to be(allowed)
      end
    end
  end

  describe "the auth payload" do
    it "describes each role's capabilities" do
      get "/api/v1/auth/me", headers: headers_for(manager)
      expect(json.dig("user", "role")).to eq("manager")
      expect(json.dig("user", "is_admin")).to be(false)
      expect(json.dig("user", "capabilities")).to include(
        "approve_time" => true, "manage_team_time" => true, "approve_leave" => true, "unlock_kiosk" => true,
        "export_hours_reports" => true, "send_pay_statements" => true,
        "manage_settings" => false, "manage_users" => false, "manage_payroll" => false, "preview_pay" => false,
        "manage_site" => false, "manage_schedules" => false
      )

      get "/api/v1/auth/me", headers: headers_for(owner)
      expect(json.dig("user")).to include("role" => "owner", "is_admin" => true, "is_owner" => true)
      expect(json.dig("user", "capabilities").values).to all(be(true))
    end
  end

  describe "the payroll connection" do
    it "only lets owners and admins hold a payroll delegation" do
      expect(PayrollIntegrationGrant.new(user: manager).tap(&:validate).errors[:user]).to include("must be an AIRE administrator")
      expect(PayrollIntegrationGrant.new(user: owner).tap(&:validate).errors[:user]).to be_empty
    end
  end
end
