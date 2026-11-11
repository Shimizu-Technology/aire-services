# frozen_string_literal: true

require "rails_helper"
require_relative "../support/frontend_fixtures"

RSpec.describe AccessGuide do
  include FrontendFixtures

  let(:owner) { User.instantiate("id" => -1, "role" => "owner", "is_active" => true, "personal_access_enabled" => true) }

  it "has plain words for every capability" do
    expect(described_class::CAPABILITY_DETAILS.keys).to match_array(User::ROLE_CAPABILITIES.keys)
  end

  it "refuses to describe a capability it has no words for" do
    stub_const("User::ROLE_CAPABILITIES", User::ROLE_CAPABILITIES.merge(fly_the_plane: User::ADMINISTRATOR_ROLES))
    expect { described_class.new(viewer: owner).as_json }.to raise_error(KeyError, /fly_the_plane/)
  end

  it "names roles in a sentence" do
    expect(described_class.roles_phrase(%w[owner admin])).to eq("Owners and admins")
    expect(described_class.roles_phrase(%w[owner admin manager])).to eq("Owners, admins and managers")
    expect(described_class.roles_phrase(User::ROLES)).to eq("Everyone")
  end

  # The frontend renders this exact payload (an owner, default settings, no
  # team yet) and checks it against its own copy of the role capabilities.
  it "matches the frontend fixture" do
    expect(User.count).to eq(0)
    expect_frontend_fixture_current("access-guide.json", described_class.new(viewer: owner).as_json)
  end
end
