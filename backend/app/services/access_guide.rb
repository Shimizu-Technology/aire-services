# frozen_string_literal: true

# What each role can do, for the Roles & access page. Nothing here decides
# access: the matrix is read from User::ROLE_CAPABILITIES and the assignment
# rows come from asking User#can_assign_role?, #can_change_access_for? and
# #can_review_own_time? about sample people, so the page shows what the app
# enforces. Only the wording lives here.
class AccessGuide
  ROLE_DETAILS = {
    "owner" => {
      label: "Owner",
      plural: "Owners",
      summary: "Everything an admin can do, plus making people owners or admins and changing an owner's or admin's access."
    },
    "admin" => {
      label: "Admin",
      plural: "Admins",
      summary: "Runs AIRE day to day: settings, the team, payroll, approvals and pay previews."
    },
    "manager" => {
      label: "Manager",
      plural: "Managers",
      summary: "Runs the team's time: approvals, corrections, leave, the kiosk, hours reports and pay stubs. No settings, payroll or pay amounts."
    },
    "employee" => {
      label: "Employee",
      plural: "Employees",
      summary: "Their own time, schedule, leave and, when it's on for them, My Pay."
    }
  }.freeze

  # Plain words for each User::ROLE_CAPABILITIES key, in the order the grid
  # shows them. A capability without words here raises, so a new capability
  # can't reach the page undescribed.
  CAPABILITY_DETAILS = {
    approve_time: { label: "Approve time", detail: "Approve or deny shifts and overtime in the approvals list." },
    manage_team_time: { label: "Manage the team's time", detail: "See everyone's time; add, correct or delete entries; clock people in or out." },
    approve_leave: { label: "Approve leave", detail: "Approve or decline leave requests." },
    unlock_kiosk: { label: "Unlock the kiosk", detail: "Open the shared kiosk so people can clock in with their PIN." },
    export_hours_reports: { label: "Export hours reports", detail: "Download hours as PDF or CSV." },
    send_pay_statements: { label: "Send pay stubs", detail: "Send stubs from the Pay stubs page and answer kiosk requests." },
    manage_schedules: { label: "Edit the schedule", detail: "Add, change and clear shifts." },
    manage_users: { label: "Manage the team", detail: "Add people and change their access, department, work categories and kiosk PIN; terminate or reactivate them." },
    manage_my_pay_access: { label: "Turn My Pay on or off", detail: "For one person or for everyone, on the Team page." },
    preview_pay: { label: "Preview anyone's My Pay", detail: "A read-only view of a worker's pay statements, including amounts." },
    manage_payroll: { label: "Run payroll", detail: "The pay calendar, cutoffs, lock times, payroll batches, pay rates and the payroll connection." },
    manage_settings: { label: "Change settings", detail: "Clock rules, time approvals, pay stub switches, schedules, departments and time categories." },
    manage_site: { label: "Edit the public website", detail: "Website photos, contact details, social links and the contact form." },
    view_activity: { label: "See activity history", detail: "The record of who changed what, and when." }
  }.freeze

  # What every signed-in team member can do, whatever their role.
  EVERYONE_CAN = [
    "Clock in and out, and see their own time",
    "See the schedule, when schedules are in use",
    "Request leave"
  ].freeze

  def self.roles_phrase(roles)
    plurals = Array(roles).map { |role| ROLE_DETAILS.fetch(role.to_s)[:plural] }
    return "Nobody" if plurals.empty?
    return "Everyone" if plurals.size == User::ROLES.size

    plurals.map.with_index { |plural, index| index.zero? ? plural : plural.downcase }
      .to_sentence(two_words_connector: " and ", last_word_connector: " and ")
  end

  def initialize(viewer:)
    @viewer = viewer
  end

  def as_json(*)
    {
      viewer: { role: viewer.role, can_see_members: show_members?, can_change_settings: viewer.can_manage_settings? },
      roles: User::ROLES.map { |role| role_card(role) },
      rows: rows,
      rules: ground_rules,
      settings: setting_effects,
      everyone_can: EVERYONE_CAN,
      role_capabilities: User::ROLE_CAPABILITIES.transform_keys(&:to_s)
    }
  end

  private

  attr_reader :viewer

  def show_members?
    viewer.can_manage_users?
  end

  def capability_keys
    @capability_keys ||= begin
      described = CAPABILITY_DETAILS.keys
      missing = User::ROLE_CAPABILITIES.keys - described
      raise KeyError, "AccessGuide::CAPABILITY_DETAILS has no words for #{missing.join(', ')}" if missing.any?

      described & User::ROLE_CAPABILITIES.keys
    end
  end

  def rows
    @rows ||= capability_rows + rule_rows
  end

  # A role's card lists the grid rows it can and can't do, so the card and
  # the grid never disagree.
  def role_card(role)
    can, cannot = rows.partition { |row| row.dig(:cells, role, :value) != "no" }
    card = {
      key: role,
      label: ROLE_DETAILS.fetch(role)[:label],
      summary: ROLE_DETAILS.fetch(role)[:summary],
      can: can.map { |row| row[:key] },
      cannot: cannot.map { |row| row[:key] },
      assigned_by: User::ROLES.select { |actor_role| sample_user(actor_role).can_assign_role?(User.new, role) },
      signs_in_personally: User::SUPERVISOR_ROLES.include?(role)
    }
    card[:members] = members_by_role.fetch(role, []) if show_members?
    card
  end

  def members_by_role
    @members_by_role ||= User.staff.where(is_active: true)
      .order(:first_name, :last_name, :id)
      .group_by(&:role)
      .transform_values { |users| users.map { |user| { id: user.id, name: user.full_name } } }
  end

  def capability_rows
    capability_keys.map do |capability|
      roles = User::ROLE_CAPABILITIES.fetch(capability)
      footnotes = footnotes_for(capability.to_s)
      {
        key: capability.to_s,
        kind: "capability",
        label: CAPABILITY_DETAILS.fetch(capability)[:label],
        detail: CAPABILITY_DETAILS.fetch(capability)[:detail],
        cells: User::ROLES.index_with { |role| roles.include?(role) ? cell("yes", footnotes: footnotes) : cell("no") },
        footnotes: footnotes
      }
    end
  end

  def rule_rows
    [ approve_own_time_row, assign_roles_row, change_admin_access_row, see_own_pay_row, get_own_stubs_row ]
  end

  def approve_own_time_row
    footnotes = footnotes_for("approve_own_time")
    {
      key: "approve_own_time",
      kind: "rule",
      label: "Approve their own time",
      detail: "Approve, deny or override time and overtime that is their own. An owner's, admin's or manager's own clock time always waits in the approvals list and is never auto-approved.",
      cells: User::ROLES.index_with do |role|
        sample = sample_user(role)
        next cell("no") unless sample.can_approve_time?
        next cell("yes") if sample.can_review_own_time? && sample.administrator?

        if sample.can_review_own_time?
          cell("yes", "While the setting is on", footnotes: footnotes)
        else
          cell("no", "Another approver does it while the setting is off", footnotes: footnotes)
        end
      end,
      footnotes: footnotes
    }
  end

  def assign_roles_row
    {
      key: "assign_roles",
      kind: "rule",
      label: "Give someone a role",
      detail: "Choose a person's role on the Team page. Nobody can change their own role.",
      cells: User::ROLES.index_with do |role|
        assignable = sample_user(role).roles_assignable_to(User.new)
        if assignable.empty?
          cell("no")
        elsif assignable.size == User::ROLES.size
          cell("yes", "Any role")
        else
          cell("limited", "#{assignable.map { |r| ROLE_DETAILS.fetch(r)[:label] }.to_sentence(two_words_connector: ' or ', last_word_connector: ' or ')} only")
        end
      end,
      footnotes: []
    }
  end

  def change_admin_access_row
    {
      key: "change_admin_access",
      kind: "rule",
      label: "Change an owner's or admin's access",
      detail: "Terminate, reactivate or delete an owner or admin, or turn off their sign-in.",
      cells: User::ROLES.index_with do |role|
        actor = sample_user(role)
        targets = User::ADMINISTRATOR_ROLES.map { |target_role| sample_user(target_role, id: -100) }
        targets.all? { |target| actor.can_change_access_for?(target) } ? cell("yes") : cell("no")
      end,
      footnotes: []
    }
  end

  def see_own_pay_row
    everyone = Setting.my_pay_enabled_for_all?
    footnotes = footnotes_for("see_own_pay")
    {
      key: "see_own_pay",
      kind: "rule",
      label: "See their own pay in My Pay",
      detail: "Their own pay statements and stubs. Any role, once My Pay is on for them.",
      cells: User::ROLES.index_with { everyone ? cell("yes", footnotes: footnotes) : cell("limited", "When their My Pay switch is on", footnotes: footnotes) },
      footnotes: footnotes
    }
  end

  def get_own_stubs_row
    kiosk = SettingsCatalog.enabled?(Setting::PAY_STUB_KIOSK_REQUESTS_KEY)
    self_email = SettingsCatalog.enabled?(Setting::PAY_STUB_SELF_EMAIL_KEY)
    note = if kiosk && self_email then "At the kiosk or by email from My Pay"
    elsif kiosk then "By asking at the kiosk"
    elsif self_email then "By email from My Pay"
    end
    footnotes = footnotes_for("get_own_stubs")
    {
      key: "get_own_stubs",
      kind: "rule",
      label: "Get their own pay stubs without asking",
      detail: "Ask at the kiosk, or email one to themselves from My Pay.",
      cells: User::ROLES.index_with { note ? cell("yes", note, footnotes: footnotes) : cell("no", "Both pay stub switches are off", footnotes: footnotes) },
      footnotes: footnotes
    }
  end

  def ground_rules
    supervisors = self.class.roles_phrase(User::SUPERVISOR_ROLES)
    [
      { key: "own_role", text: "Nobody can change their own role." },
      { key: "last_owner", text: "AIRE always keeps at least one active owner who signs in. The last one can't be given another role, terminated or lose sign-in." },
      { key: "personal_sign_in", text: "#{supervisors} always sign in personally. Only employees can be kiosk-only." },
      { key: "break_glass", text: "If no owner can sign in, Shimizu Technology can restore an owner with a recorded break-glass step." }
    ]
  end

  def setting_effects
    SettingsCatalog.with_access_effect.map do |entry|
      enabled = SettingsCatalog.enabled?(entry[:id])
      section = SettingsCatalog::SECTIONS.fetch(entry[:section])
      effect = {
        id: entry[:id],
        label: entry[:label],
        enabled: enabled,
        effect: entry.dig(:access_effect, enabled ? :on : :off),
        rows: entry.dig(:access_effect, :rows),
        change_in: "#{section[:page]} → #{section[:label]}",
        path: section[:path],
        who: self.class.roles_phrase(User::ROLE_CAPABILITIES.fetch(entry[:capability]))
      }
      effect[:individual_count] = User.staff.where(is_active: true, my_pay_enabled: true).count if entry[:id] == Setting::MY_PAY_FOR_ALL_KEY && show_members?
      effect
    end
  end

  def footnotes_for(row_key)
    SettingsCatalog.with_access_effect.select { |entry| entry.dig(:access_effect, :rows).include?(row_key) }.map { |entry| entry[:id] }
  end

  # One answer in the grid. footnotes are the settings that change this
  # answer, so the page can point at them from the right cells only.
  def cell(value, note = nil, footnotes: [])
    { value: value, note: note, footnotes: footnotes.presence }.compact
  end

  # A persisted-looking, active person with this role, for asking the User
  # permission methods. Never saved.
  def sample_user(role, id: nil)
    @sample_users ||= {}
    @sample_users[[ role, id ]] ||= User.instantiate(
      "id" => id || -(User::ROLES.index(role) + 1),
      "role" => role,
      "is_active" => true,
      "personal_access_enabled" => true
    )
  end
end
