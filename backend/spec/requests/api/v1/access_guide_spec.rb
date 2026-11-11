# frozen_string_literal: true

require "rails_helper"

RSpec.describe "GET /api/v1/access_guide", type: :request do
  let!(:owner) { create(:user, :owner, first_name: "Leon", last_name: "Owner") }
  let!(:admin) { create(:user, :admin, first_name: "Chels", last_name: "Admin") }
  let!(:manager) { create(:user, :manager, first_name: "Roke", last_name: "Manager") }
  let!(:employee) { create(:user, :employee, first_name: "Kai", last_name: "Blas", my_pay_enabled: true) }

  def headers_for(user)
    { "Authorization" => "Bearer test_token_#{user.id}" }
  end

  def json
    response.parsed_body
  end

  def row(key)
    json.fetch("rows").find { |candidate| candidate["key"] == key }
  end

  def cell_values(key)
    row(key).fetch("cells").transform_values { |cell| cell["value"] }
  end

  it "needs a signed-in team member" do
    get "/api/v1/access_guide"
    expect(response).to have_http_status(:unauthorized)
  end

  { owner: true, admin: true, manager: false, employee: false }.each do |role, sees_members|
    context "as #{role}" do
      before { get "/api/v1/access_guide", headers: headers_for(public_send(role)) }

      it "returns one card per role, the grid, the ground rules and the setting footnotes" do
        expect(response).to have_http_status(:ok)
        expect(json.keys).to contain_exactly("viewer", "roles", "rows", "rules", "settings", "everyone_can", "role_capabilities")
        expect(json.fetch("viewer")).to eq("role" => role.to_s, "can_see_members" => sees_members, "can_change_settings" => sees_members)
        expect(json.fetch("roles").map { |card| card["key"] }).to eq(User::ROLES)
        expect(json.fetch("roles")).to all(include("label", "summary", "can", "cannot", "assigned_by", "signs_in_personally"))
        expect(json.fetch("rows")).to all(include("key", "kind", "label", "detail", "cells", "footnotes"))
        expect(json.fetch("rows").map { |candidate| candidate["cells"].keys }).to all(eq(User::ROLES))
        expect(json.fetch("rules").map { |rule| rule["key"] }).to eq(%w[own_role last_owner personal_sign_in break_glass])
      end

      it "#{sees_members ? 'names' : 'does not name'} who has each role" do
        cards = json.fetch("roles").index_by { |card| card["key"] }
        if sees_members
          expect(cards.fetch("owner")["members"]).to eq([ { "id" => owner.id, "name" => "Leon Owner" } ])
          expect(cards.fetch("employee")["members"].map { |member| member["name"] }).to eq([ "Kai Blas" ])
          expect(json.fetch("settings").find { |effect| effect["id"] == "my_pay_enabled_for_all" }["individual_count"]).to eq(1)
        else
          expect(cards.values).to all(satisfy { |card| !card.key?("members") })
          expect(json.fetch("settings")).to all(satisfy { |effect| !effect.key?("individual_count") })
        end
      end
    end
  end

  it "builds the capability grid from User::ROLE_CAPABILITIES" do
    get "/api/v1/access_guide", headers: headers_for(manager)

    expect(json.fetch("role_capabilities")).to eq(User::ROLE_CAPABILITIES.transform_keys(&:to_s))
    capability_rows = json.fetch("rows").select { |candidate| candidate["kind"] == "capability" }
    expect(capability_rows.map { |candidate| candidate["key"] }).to match_array(User::ROLE_CAPABILITIES.keys.map(&:to_s))
    capability_rows.each do |candidate|
      allowed = User::ROLE_CAPABILITIES.fetch(candidate["key"].to_sym)
      expect(candidate["cells"].select { |_role, cell| cell["value"] == "yes" }.keys).to eq(allowed), candidate["key"]
    end
  end

  it "keeps each role card in step with the grid" do
    get "/api/v1/access_guide", headers: headers_for(owner)

    json.fetch("roles").each do |card|
      allowed = json.fetch("rows").reject { |candidate| candidate.dig("cells", card["key"], "value") == "no" }.map { |candidate| candidate["key"] }
      expect(card["can"]).to eq(allowed)
      expect(card["can"] + card["cannot"]).to match_array(json.fetch("rows").map { |candidate| candidate["key"] })
    end
  end

  it "shows the role-assignment rules the Team page enforces" do
    get "/api/v1/access_guide", headers: headers_for(owner)

    expect(cell_values("assign_roles")).to eq("owner" => "yes", "admin" => "limited", "manager" => "no", "employee" => "no")
    expect(row("assign_roles").dig("cells", "admin", "note")).to eq("Manager or Employee only")
    expect(cell_values("change_admin_access")).to eq("owner" => "yes", "admin" => "no", "manager" => "no", "employee" => "no")
    assigned_by = json.fetch("roles").to_h { |card| [ card["key"], card["assigned_by"] ] }
    expect(assigned_by).to eq("owner" => %w[owner], "admin" => %w[owner], "manager" => %w[owner admin], "employee" => %w[owner admin])

    User::ROLES.each do |role|
      other_role = (User::ROLES - [ role ]).first
      actor = create(:user, role: role)
      expect(actor.can_assign_role?(actor, other_role)).to be(false)
    end
  end

  it "follows the self-approval setting" do
    get "/api/v1/access_guide", headers: headers_for(manager)
    expect(cell_values("approve_own_time")).to eq("owner" => "yes", "admin" => "yes", "manager" => "yes", "employee" => "no")
    expect(row("approve_own_time")["footnotes"]).to eq([ "managers_can_approve_own_time" ])
    expect(row("approve_own_time")["cells"].transform_values { |cell| cell["footnotes"] }).to eq(
      "owner" => nil, "admin" => nil, "manager" => [ "managers_can_approve_own_time" ], "employee" => nil
    )
    footnote = json.fetch("settings").find { |effect| effect["id"] == "managers_can_approve_own_time" }
    expect(footnote).to include("enabled" => true, "change_in" => "Settings → Time approvals", "who" => "Owners and admins")

    Setting.set(Setting::MANAGERS_CAN_APPROVE_OWN_TIME_KEY, "false")
    get "/api/v1/access_guide", headers: headers_for(manager)
    expect(cell_values("approve_own_time")).to eq("owner" => "yes", "admin" => "yes", "manager" => "no", "employee" => "no")
    expect(json.fetch("settings").find { |effect| effect["id"] == "managers_can_approve_own_time" }).to include(
      "enabled" => false, "effect" => "A manager's own time goes to an owner, an admin or another manager."
    )
  end

  it "follows the My Pay and pay stub switches" do
    get "/api/v1/access_guide", headers: headers_for(employee)
    expect(cell_values("see_own_pay").values.uniq).to eq([ "limited" ])
    expect(cell_values("get_own_stubs").values.uniq).to eq([ "no" ])

    Setting.set(Setting::MY_PAY_FOR_ALL_KEY, "true")
    Setting.set(Setting::PAY_STUB_SELF_EMAIL_KEY, "true")
    get "/api/v1/access_guide", headers: headers_for(employee)
    expect(cell_values("see_own_pay").values.uniq).to eq([ "yes" ])
    expect(row("get_own_stubs").dig("cells", "employee")).to eq(
      "value" => "yes", "note" => "By email from My Pay", "footnotes" => %w[pay_stub_kiosk_requests_enabled pay_stub_self_email_enabled]
    )
    expect(json.fetch("settings").to_h { |effect| [ effect["id"], effect["enabled"] ] }).to eq(
      "managers_can_approve_own_time" => true,
      "pay_stub_kiosk_requests_enabled" => false,
      "pay_stub_self_email_enabled" => true,
      "my_pay_enabled_for_all" => true
    )
  end
end
