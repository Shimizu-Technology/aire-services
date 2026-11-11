# frozen_string_literal: true

# Every setting an owner or admin can change in AIRE, with the help text the
# Settings page shows for it. This is the one place that says what a setting
# does; the Settings page and the Roles & access page both read it from here.
#
# Adding a setting? Add an entry below in the same commit. The spec in
# spec/models/settings_catalog_spec.rb fails while any key in
# Admin::SettingsController::SETTING_KEYS, Setting::DEFAULTS or a
# Setting.set(...) call has no entry. Then refresh the frontend fixture:
#
#   UPDATE_FRONTEND_FIXTURES=1 bundle exec rspec spec/models/settings_catalog_spec.rb
#
# Each entry:
#   id            stable identifier the frontend looks entries up by
#   label         the name on the page
#   section       a SECTIONS key
#   setting_keys  Setting keys the entry covers (empty when stored elsewhere)
#   stored_in     where the value lives when it isn't a Setting key
#   capability    the User::ROLE_CAPABILITIES key that may change it; "who
#                 can change it" is generated from this
#   what, default, example  the help text, in plain words
#   on_page       false when the Settings page shows the value but has no
#                 control for it yet
#   access_effect when the setting changes an answer on the Roles & access
#                 page: { rows:, on:, off: } where rows are AccessGuide row
#                 keys and on/off say what the setting means in each state
class SettingsCatalog
  SECTIONS = {
    time_clock_rules: { label: "Time clock rules", page: "Settings", path: "/admin/settings#time-clock-rules" },
    time_approvals: { label: "Time approvals", page: "Settings", path: "/admin/settings#time-approvals" },
    pay_stubs: { label: "Pay stubs", page: "Settings", path: "/admin/settings#pay-stubs" },
    departments: { label: "Departments", page: "Settings", path: "/admin/settings#departments" },
    contact: { label: "Contact settings", page: "Settings", path: "/admin/settings#contact-settings" },
    time_categories: { label: "Time categories", page: "Settings", path: "/admin/settings#time-categories" },
    my_pay: { label: "My Pay", page: "Team", path: "/admin/users" }
  }.freeze

  ENTRIES = [
    {
      id: "overtime_daily_threshold_hours",
      label: "Daily hours review alert",
      section: :time_clock_rules,
      setting_keys: %w[overtime_daily_threshold_hours],
      capability: :manage_settings,
      what: "Shows a review alert on a person's clock card once they pass this many hours in one day. It doesn't change pay or ask anyone to approve overtime.",
      default: "8 hours",
      example: "At 8, someone who has worked 8.5 hours today sees the alert. Their pay is the same."
    },
    {
      id: "overtime_weekly_threshold_hours",
      label: "Weekly hours review alert",
      section: :time_clock_rules,
      setting_keys: %w[overtime_weekly_threshold_hours],
      capability: :manage_settings,
      what: "Shows a review alert on a person's clock card once they pass this many hours in the Sunday–Saturday week. Overtime pay still starts after 40 hours, whatever this is set to.",
      default: "40 hours",
      example: "At 36, someone with 37 hours this week sees the alert so a manager can plan. Overtime pay still starts after 40."
    },
    {
      id: "early_clock_in_buffer_minutes",
      label: "Early clock-in buffer",
      section: :time_clock_rules,
      setting_keys: %w[early_clock_in_buffer_minutes],
      capability: :manage_settings,
      what: "How many minutes before a scheduled shift someone can clock in. Clocking in up to this many minutes after the start still counts as on time. People with no schedule that day aren't affected.",
      default: "5 minutes",
      example: "At 5, for a 7:00 AM shift: clock-in opens at 6:55 AM, and clocking in by 7:05 AM counts as on time."
    },
    {
      id: "schedule_required_for_clock_in",
      label: "Require a scheduled shift to clock in",
      section: :time_clock_rules,
      setting_keys: %w[schedule_required_for_clock_in],
      capability: :manage_settings,
      on_page: false,
      what: "When on, people can't clock in on a day with no shift on the schedule. An owner, admin or manager can still clock them in. There's no switch for this on the Settings page yet.",
      default: "Off",
      example: "When on, someone with no shift on Saturday is told to contact their manager if they try to clock in."
    },
    {
      id: "clock_in_location_enforced",
      label: "Clock-in location restriction",
      section: :time_clock_rules,
      setting_keys: %w[clock_in_location_enforced],
      capability: :manage_settings,
      what: "When on, people clocking themselves in from a phone or computer must share their location and be within the allowed radius of the pin. Kiosk clock-ins, and clock-ins an owner, admin or manager does for someone else, aren't checked.",
      default: "Off",
      example: "When on, a pilot can clock in on their phone at the hangar but not from home."
    },
    {
      id: "clock_in_location_name",
      label: "Location label",
      section: :time_clock_rules,
      setting_keys: %w[clock_in_location_name],
      capability: :manage_settings,
      what: "The place name people see in the message when their location blocks a clock-in.",
      default: "AIRE Services Guam",
      example: "Set to \"AIRE hangar\", someone too far away sees \"Clock-in is only allowed while you are at AIRE hangar.\""
    },
    {
      id: "clock_in_location_pin",
      label: "Location pin",
      section: :time_clock_rules,
      setting_keys: %w[clock_in_location_latitude clock_in_location_longitude],
      capability: :manage_settings,
      what: "The point the allowed radius is measured from. Set it by searching for an address, using your current location, or typing the coordinates under Advanced coordinates.",
      default: "Latitude 13.46913, longitude 144.79901",
      example: "Move the pin to a new hangar before turning the restriction on there."
    },
    {
      id: "clock_in_location_radius_meters",
      label: "Allowed radius",
      section: :time_clock_rules,
      setting_keys: %w[clock_in_location_radius_meters],
      capability: :manage_settings,
      what: "How far from the pin, in meters, someone can be and still clock in. AIRE adds the phone's reported accuracy, up to 250 meters more.",
      default: "1000 meters",
      example: "At 1000 meters, with a phone accurate to 50 meters, clock-in works up to 1050 meters from the pin."
    },
    {
      id: "managers_can_approve_own_time",
      label: "Managers can approve their own time",
      section: :time_approvals,
      setting_keys: [ Setting::MANAGERS_CAN_APPROVE_OWN_TIME_KEY ],
      capability: :manage_settings,
      what: "When on, a manager can approve, deny and override their own time and overtime, as owners and admins can. When off, an owner, an admin or another manager has to approve it. Owners and admins can always approve their own time.",
      default: "On",
      example: "When off, Roke's own shifts wait for Chels, Leon or another manager to approve them.",
      access_effect: {
        rows: %w[approve_own_time],
        on: "Managers approve their own time.",
        off: "A manager's own time goes to an owner, an admin or another manager."
      }
    },
    {
      id: "pay_stub_kiosk_requests_enabled",
      label: "Pay stub requests at the kiosk",
      section: :pay_stubs,
      setting_keys: [ Setting::PAY_STUB_KIOSK_REQUESTS_KEY ],
      capability: :manage_settings,
      what: "Adds \"Request my pay stub\" at the kiosk after a worker enters their PIN. Requests wait on the Pay stubs page for an owner, admin or manager to send. Workers don't need My Pay for this.",
      default: "Off",
      example: "When on, a worker can ask for last week's stub at the kiosk, and Chels sends it from the Pay stubs page.",
      access_effect: {
        rows: %w[get_own_stubs],
        on: "Workers can ask for a pay stub at the kiosk.",
        off: "Workers can't ask for pay stubs at the kiosk."
      }
    },
    {
      id: "pay_stub_self_email_enabled",
      label: "Workers can email themselves stubs",
      section: :pay_stubs,
      setting_keys: [ Setting::PAY_STUB_SELF_EMAIL_KEY ],
      capability: :manage_settings,
      what: "Adds \"Email me this stub\" to each paycheck in My Pay. The link goes only to the email on file. Workers also need My Pay turned on.",
      default: "Off",
      example: "When on, someone with My Pay can email a stub to their own address without asking anyone.",
      access_effect: {
        rows: %w[get_own_stubs],
        on: "Workers with My Pay can email themselves a stub.",
        off: "Workers can't email themselves stubs; a sender does it from the Pay stubs page."
      }
    },
    {
      id: "pay_stub_request_notification_emails",
      label: "Heads-up emails for kiosk requests",
      section: :pay_stubs,
      setting_keys: [ PayDocuments::REQUEST_NOTICE_SETTING ],
      capability: :manage_settings,
      what: "Who gets an email when a worker asks for a stub at the kiosk, up to 10 addresses. The email names the person and what they asked for, never pay details. With nobody listed, requests appear only on the Pay stubs page.",
      default: "Nobody",
      example: "Add Chels's address so Chels hears about new requests without checking the Pay stubs page."
    },
    {
      id: "approval_groups",
      label: "Departments",
      section: :departments,
      setting_keys: %w[approval_groups],
      capability: :manage_settings,
      what: "The departments people can be put in on the Team page. In the approvals list they let you filter pending time by department. They don't limit who can approve. A department can't be removed while someone is still in it.",
      default: "CFI and Ops / Maintenance",
      example: "Add \"Front desk\", put the desk staff in it, then filter approvals to just their time."
    },
    {
      id: "time_categories",
      label: "Time categories",
      section: :time_categories,
      setting_keys: [],
      stored_in: "time_categories",
      capability: :manage_settings,
      what: "The kinds of work people clock in under. Each person can pick only the active categories assigned to them on the Team page, and needs at least one to clock in. Turning a category off keeps it on past entries.",
      default: "None until you add them",
      example: "Add \"Charter flight\" and assign it to two pilots. Only they can clock in under it."
    },
    {
      id: "public_contact_settings",
      label: "Public contact details",
      section: :contact,
      setting_keys: %w[public_contact_settings],
      capability: :manage_site,
      what: "The phone numbers, email and address shown on the public website. The first phone row is the main number behind the site's call buttons.",
      default: "(671) 477-4243, admin@aireservicesguam.com, 353 Admiral Sherman Boulevard",
      example: "Change the WhatsApp number here and the website's contact page shows the new one."
    },
    {
      id: "public_social_links",
      label: "Public social links",
      section: :contact,
      setting_keys: %w[public_social_links],
      capability: :manage_site,
      what: "The social media links in the website footer and on the contact page.",
      default: "Instagram and Facebook",
      example: "Add a YouTube link and it appears in the website footer."
    },
    {
      id: "contact_email",
      label: "Notification recipient emails",
      section: :contact,
      setting_keys: %w[contact_email],
      capability: :manage_site,
      what: "Every address listed gets an email when someone sends the website contact form. At least one is required.",
      default: "admin@aireservicesguam.com",
      example: "Add a second inbox and both get each new website inquiry."
    },
    {
      id: "contact_inquiry_topics",
      label: "Public inquiry topics",
      section: :contact,
      setting_keys: %w[contact_inquiry_topics],
      capability: :manage_site,
      what: "The topics visitors choose from on the website contact form. At least one is required.",
      default: "Private Pilot Certificate, Aerial Tours, Aircraft Rental, Careers, General Inquiry",
      example: "Add \"Gift certificates\" and it shows up in the form's topic list."
    },
    {
      id: "my_pay_enabled_for_all",
      label: "My Pay for everyone",
      section: :my_pay,
      setting_keys: [ Setting::MY_PAY_FOR_ALL_KEY ],
      capability: :manage_my_pay_access,
      what: "When on, every active team member can open My Pay to see their own pay statements and stubs. When off, only people whose own My Pay switch is on can.",
      default: "Off",
      example: "Turn it on once statements have been checked, so everyone gets My Pay on the same day.",
      access_effect: {
        rows: %w[see_own_pay],
        on: "Every active team member can see My Pay.",
        off: "Only people with My Pay turned on individually can see it."
      }
    },
    {
      id: "my_pay_enabled",
      label: "My Pay for one person",
      section: :my_pay,
      setting_keys: [],
      stored_in: "users.my_pay_enabled",
      capability: :manage_my_pay_access,
      what: "Turns My Pay on for one person, from their row on the Team page. It makes no difference while My Pay for everyone is on.",
      default: "Off",
      example: "Turn it on for Roke first to check the statements look right, then turn it on for everyone."
    }
  ].map(&:freeze).freeze

  class << self
    def entries
      ENTRIES
    end

    def find(id)
      ENTRIES.find { |entry| entry[:id] == id.to_s }
    end

    def setting_keys
      ENTRIES.flat_map { |entry| entry[:setting_keys] }
    end

    def with_access_effect
      ENTRIES.select { |entry| entry[:access_effect] }
    end

    # Whether an on/off entry is on right now.
    def enabled?(id)
      case id.to_s
      when Setting::MANAGERS_CAN_APPROVE_OWN_TIME_KEY then Setting.managers_can_approve_own_time?
      when Setting::MY_PAY_FOR_ALL_KEY then Setting.my_pay_enabled_for_all?
      else
        key = find(id)&.dig(:setting_keys, 0) or raise ArgumentError, "No catalog entry #{id}"
        Setting.get(key) == "true"
      end
    end

    def as_json(*)
      ENTRIES.map { |entry| serialize(entry) }
    end

    def sections_as_json
      SECTIONS.map { |key, section| { key: key.to_s, **section } }
    end

    private

    def serialize(entry)
      section = SECTIONS.fetch(entry[:section])
      roles = User::ROLE_CAPABILITIES.fetch(entry[:capability])
      {
        id: entry[:id],
        label: entry[:label],
        section: entry[:section].to_s,
        section_label: section[:label],
        page: section[:page],
        path: section[:path],
        setting_keys: entry[:setting_keys],
        stored_in: entry[:stored_in],
        on_page: entry.fetch(:on_page, true),
        capability: entry[:capability].to_s,
        who_roles: roles,
        who: AccessGuide.roles_phrase(roles),
        what: entry[:what],
        default: entry[:default],
        example: entry[:example],
        access_effect: entry[:access_effect]
      }
    end
  end
end
