# frozen_string_literal: true

require "rails_helper"

RSpec.describe UserAccessConfiguration, type: :service do
  let(:actor) { create(:user, :admin) }
  let(:category) { create(:time_category) }

  def apply(user, attributes, creating: false)
    described_class.new(user: user, attributes: attributes, actor: actor, creating: creating).tap(&:apply!)
  end

  it "creates a personal account without storing an admin-entered name" do
    user = User.new(clerk_id: "pending_personal", role: "employee", is_active: true)

    apply(
      user,
      {
        personal_access_enabled: true,
        email: "Pilot@Example.com",
        first_name: "Duplicate",
        last_name: "Name",
        time_tracking_enabled: false,
        kiosk_enabled: false
      },
      creating: true
    )

    expect(user).to have_attributes(
      email: "pilot@example.com",
      first_name: nil,
      last_name: nil,
      profile_source: "clerk",
      personal_access_enabled: true,
      time_tracking_enabled: false,
      kiosk_enabled: false
    )
  end

  it "creates a kiosk-only employee with a local name, category, and generated PIN" do
    user = User.new(clerk_id: "pending_kiosk", role: "employee", is_active: true)

    configuration = apply(
      user,
      {
        personal_access_enabled: false,
        first_name: "Local",
        last_name: "Pilot",
        time_tracking_enabled: true,
        kiosk_enabled: true,
        time_category_ids: [ category.id ]
      },
      creating: true
    )

    expect(user).to have_attributes(
      email: nil,
      first_name: "Local",
      last_name: "Pilot",
      profile_source: "local",
      personal_access_enabled: false,
      time_tracking_enabled: true,
      kiosk_enabled: true
    )
    expect(configuration.generated_pin).to match(/\A\d{6}\z/)
    expect(user.verify_kiosk_pin(configuration.generated_pin)).to be(true)
    expect(user.assigned_time_categories).to contain_exactly(category)
  end

  it "allows a personal account that does not track hours" do
    user = create(:user, time_tracking_enabled: false, kiosk_enabled: false)

    expect {
      apply(user, { personal_access_enabled: true, time_tracking_enabled: false, kiosk_enabled: false })
    }.not_to raise_error
  end

  it "requires at least one active category when time tracking is enabled" do
    user = create(:user)

    expect {
      apply(user, { time_tracking_enabled: true, kiosk_enabled: false, time_category_ids: [] })
    }.to raise_error(described_class::ConfigurationError, /at least one work category/i)
  end

  it "keeps a kiosk profile local while personal activation is pending" do
    user = create(:user, :kiosk_only, clerk_id: "pending_kiosk_transition", first_name: "Local")
    user.user_time_categories.create!(time_category: category)
    original_digest = user.kiosk_pin_digest

    apply(
      user,
      {
        personal_access_enabled: true,
        email: "transition@example.com",
        time_category_ids: [ category.id ]
      }
    )

    expect(user.reload).to have_attributes(
      personal_access_enabled: true,
      profile_source: "local",
      first_name: "Local",
      kiosk_enabled: true,
      kiosk_pin_digest: original_digest
    )
    expect(user).to be_pending_invite
  end

  it "converts an activated personal account to kiosk-only without replacing its record or history" do
    user = create(:user, clerk_id: "clerk_permanent", first_name: "Clerk", last_name: "Pilot")
    historical_entry = create(:time_entry, user: user, time_category: category)

    configuration = apply(
      user,
      {
        personal_access_enabled: false,
        first_name: "Clerk",
        last_name: "Pilot",
        time_tracking_enabled: true,
        kiosk_enabled: true,
        time_category_ids: [ category.id ]
      }
    )

    expect(user.reload).to have_attributes(
      id: historical_entry.user_id,
      clerk_id: "clerk_permanent",
      email: user.email,
      profile_source: "local",
      personal_access_enabled: false,
      kiosk_enabled: true
    )
    expect(configuration.generated_pin).to be_present
    expect(historical_entry.reload.user).to eq(user)
  end

  it "removes kiosk credentials but preserves dormant category assignments when time tracking is disabled" do
    user = create(:user, time_tracking_enabled: true, kiosk_enabled: true, kiosk_pin: "723451")
    user.user_time_categories.create!(time_category: category)

    apply(user, { time_tracking_enabled: false, kiosk_enabled: false })

    expect(user.reload).to have_attributes(time_tracking_enabled: false, kiosk_enabled: false)
    expect(user.kiosk_pin_digest).to be_nil
    expect(user.assigned_time_categories).to contain_exactly(category)
  end

  it "blocks capability transitions while the employee is clocked in" do
    user = create(:user, time_tracking_enabled: true)
    user.user_time_categories.create!(time_category: category)
    create(:time_entry, user: user, time_category: category, status: "clocked_in", clock_in_at: Time.current)

    expect {
      apply(user, { time_tracking_enabled: false, kiosk_enabled: false })
    }.to raise_error(described_class::ConfigurationError, /clock this person out/i)
  end

  it "does not allow an admin without personal sign-in" do
    user = create(:user, :admin)

    expect {
      apply(
        user,
        {
          role: "admin",
          personal_access_enabled: false,
          first_name: "Admin",
          time_tracking_enabled: true,
          kiosk_enabled: true,
          time_category_ids: [ category.id ]
        }
      )
    }.to raise_error(described_class::ConfigurationError, /admins must keep personal sign-in/i)
  end
end
