// Mirrors backend User::ROLES and User::ROLE_CAPABILITIES. The API is the
// authority and refuses anything outside a role; the UI uses this only to
// decide what to show.
export type UserRole = 'owner' | 'admin' | 'manager' | 'employee'

export const USER_ROLES: UserRole[] = ['owner', 'admin', 'manager', 'employee']

export type Capability =
  | 'manage_settings'
  | 'manage_users'
  | 'manage_payroll'
  | 'manage_schedules'
  | 'manage_site'
  | 'view_activity'
  | 'preview_pay'
  | 'manage_my_pay_access'
  | 'approve_time'
  | 'manage_team_time'
  | 'approve_leave'
  | 'unlock_kiosk'
  | 'export_hours_reports'
  | 'send_pay_statements'

export type Capabilities = Record<Capability, boolean>

const ADMINISTRATORS: UserRole[] = ['owner', 'admin']
const SUPERVISORS: UserRole[] = ['owner', 'admin', 'manager']

const ROLE_CAPABILITIES: Record<Capability, UserRole[]> = {
  manage_settings: ADMINISTRATORS,
  manage_users: ADMINISTRATORS,
  manage_payroll: ADMINISTRATORS,
  manage_schedules: ADMINISTRATORS,
  manage_site: ADMINISTRATORS,
  view_activity: ADMINISTRATORS,
  preview_pay: ADMINISTRATORS,
  manage_my_pay_access: ADMINISTRATORS,
  approve_time: SUPERVISORS,
  manage_team_time: SUPERVISORS,
  approve_leave: SUPERVISORS,
  unlock_kiosk: SUPERVISORS,
  export_hours_reports: SUPERVISORS,
  send_pay_statements: SUPERVISORS,
}

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as string[]).includes(value)
}

export function capabilitiesFor(role: UserRole | null | undefined): Capabilities {
  return Object.fromEntries(
    (Object.keys(ROLE_CAPABILITIES) as Capability[]).map((capability) => [capability, Boolean(role && ROLE_CAPABILITIES[capability].includes(role))]),
  ) as Capabilities
}

export const ROLE_DETAILS: Record<UserRole, { label: string; plural: string; help: string }> = {
  owner: {
    label: 'Owner',
    plural: 'Owners',
    help: 'Everything an admin can do, plus assigning owners and admins.',
  },
  admin: {
    label: 'Admin',
    plural: 'Admins',
    help: 'Runs the app: settings, team, payroll, approvals and pay previews.',
  },
  manager: {
    label: 'Manager',
    plural: 'Managers',
    help: 'Approves and corrects team time and leave, unlocks the kiosk, exports hours. No settings, payroll or pay amounts.',
  },
  employee: {
    label: 'Employee',
    plural: 'Employees',
    help: 'Their own time, schedule, leave and My Pay.',
  },
}

export function roleLabel(role: string | null | undefined) {
  return isUserRole(role) ? ROLE_DETAILS[role].label : 'Employee'
}

// Owners, admins and managers sign in personally; only employees can be kiosk-only.
export function roleRequiresPersonalAccess(role: UserRole) {
  return SUPERVISORS.includes(role)
}

// Roles someone may give a new team member: owners any role, admins only
// Manager and Employee. Mirrors User#can_assign_role? for a new record.
export function rolesAssignableToNewPerson(viewerRole: UserRole | null | undefined): UserRole[] {
  if (viewerRole === 'owner') return USER_ROLES
  if (viewerRole === 'admin') return ['manager', 'employee']
  return []
}
