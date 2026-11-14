import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui'
import type { AdminUser, TimeEntry } from '../../lib/api'
import { mockMatchMedia } from '../../test/matchMedia'
import ClerkProtectedContent from '../../components/auth/ClerkProtectedContent'
import Person from './Person'

const apiMock = vi.hoisted(() => ({
  getTimeEntries: vi.fn(), getTimeEntry: vi.fn(), getHoursReport: vi.fn(), getTimeCategories: vi.fn(), getPayrollCutoff: vi.fn(),
  getLeaveRequests: vi.fn(), getMyPayAccess: vi.fn(), setUserMyPay: vi.fn(), resetKioskPin: vi.fn(), deleteUser: vi.fn(), resendInvite: vi.fn(),
}))
const fetchMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api', () => ({ api: apiMock, fetchApi: fetchMock }))
const evidenceMock = vi.hoisted(() => ({ activity: vi.fn(), periods: vi.fn(), period: vi.fn(), user: vi.fn(), schedule: vi.fn() }))
vi.mock('../../lib/employeeEvidenceApi', () => ({ employeeEvidenceApi: evidenceMock }))
const stubsMock = vi.hoisted(() => ({ workers: vi.fn(), statements: vi.fn(), send: vi.fn() }))
vi.mock('../../lib/payStubsApi', () => ({
  payStubsApi: stubsMock,
  PayStubError: class PayStubError extends Error { code = 'unavailable' },
}))
const auth = vi.hoisted(() => ({ value: { isClerkEnabled: true, userRole: 'admin' as string, currentUser: { id: 99, my_pay_preview_enabled: true } as { id: number; my_pay_preview_enabled?: boolean } } }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => auth.value }))
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true }),
  useUser: () => ({ user: { primaryEmailAddress: { emailAddress: 'roke@aire.test' } } }),
  RedirectToSignIn: () => <div>Sign in</div>,
}))
const appSource = Object.values(import.meta.glob<string>('../../App.tsx', { query: '?raw', import: 'default', eager: true }))[0]

const LONG_NAME = 'Joaquin Mendiola-Taitano De Leon Guerrero'

function makeUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 7, email: 'casey@aire.test', first_name: 'Casey', last_name: 'Cruz', display_name: 'Casey Cruz', full_name: 'Casey Cruz',
    role: 'employee', staff_title: 'Certified Flight Instructor', approval_group_labels: ['CFI'], is_active: true, employment_status: 'active',
    terminated_at: null, termination_effective_on: null, termination_reason: null, terminated_by: null, can_delete_permanently: false,
    is_pending: false, has_clerk_account: true, uses_clerk_profile: true, personal_access_enabled: true, profile_source: 'clerk',
    time_tracking_enabled: true, public_team_enabled: false, public_team_name: null, public_team_title: null, public_team_sort_order: 0,
    public_team_photo_position_x: 50, public_team_photo_position_y: 50, kiosk_enabled: true, kiosk_pin_configured: true,
    time_category_ids: [1], time_categories: [{ id: 1, key: 'instruction', name: 'Instruction' }], my_pay_enabled: false, can_change_access: true,
    created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z',
    ...overrides,
  }
}

function makeEntry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 19, work_date: '2026-11-05', start_time: '08:00', end_time: '16:00', formatted_start_time: '8:00 AM', formatted_end_time: '4:00 PM',
    hours: 8, break_minutes: 0, description: null, entry_method: 'clock', status: 'completed', admin_override: false, attendance_status: null,
    approval_status: 'approved', overtime_status: 'none', clock_in_at: '2026-11-04T22:00:00Z', clock_out_at: '2026-11-05T06:00:00Z',
    approved_by: null, approved_at: null, approval_note: null, overtime_approved_by: null, overtime_approved_at: null, overtime_note: null,
    schedule: null, breaks: [], user: { id: 7, email: 'casey@aire.test', display_name: 'Casey Cruz', full_name: 'Casey Cruz', time_category_ids: [1] },
    time_category: { id: 1, name: 'Instruction' },
    ...overrides,
  } as TimeEntry
}

const totals = { worked_hours: 80.5, eligible_hours: 80.5, pending_hours: 0, denied_hours: 0, issued_hours: 78.5, committed_hours: 0, exported_hours: 0, held_hours: 0, needs_reconciliation_hours: 2, current_regular_hours: 80.5, current_overtime_hours: 0, frozen_regular_hours: 80.5, frozen_overtime_hours: 0, open_case_count: 0 }
const openPeriod = { id: '2026-11-01', start_date: '2026-11-01', end_date: '2026-11-15', review_required: true, actual_check_components: null, amount_owed: null, summary: { ...totals, eligible_hours: 51.5, pending_hours: 11.5, issued_hours: 0, needs_reconciliation_hours: 51.5 } }
const paidPeriod = { id: '2026-10-16', start_date: '2026-10-16', end_date: '2026-10-31', review_required: true, actual_check_components: null, amount_owed: null, summary: totals }
const lockedPeriod = { id: '2026-10-01', start_date: '2026-10-01', end_date: '2026-10-15', review_required: false, actual_check_components: null, amount_owed: null, summary: { ...totals, needs_reconciliation_hours: 0 } }
const states = [
  { id: 3, start_date: '2026-11-01', end_date: '2026-11-15', pay_date: '2026-11-25', status: 'scheduled', handoff_state: 'open', locked_at: null },
  { id: 2, start_date: '2026-10-16', end_date: '2026-10-31', pay_date: '2026-11-10', status: 'finalized', handoff_state: 'paid', locked_at: '2026-11-01T10:00:00+10:00' },
  { id: 1, start_date: '2026-10-01', end_date: '2026-10-15', pay_date: '2026-10-25', status: 'finalized', handoff_state: 'paid', locked_at: '2026-10-16T10:00:00+10:00' },
]

let person = makeUser()
let restoreMedia = () => {}

function Address() {
  const location = useLocation()
  return <output aria-label="Address">{location.pathname}{location.search}</output>
}

function open(path: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/users/:id" element={<Person />} />
          <Route path="*" element={null} />
        </Routes>
        <Address />
      </MemoryRouter>
    </ToastProvider>,
  )
}

const address = () => new URL(`https://local.invalid${screen.getByLabelText('Address').textContent}`)
const selectedTab = () => screen.getByRole('tab', { selected: true })

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-14T02:00:00Z'))
  restoreMedia = mockMatchMedia({ width: 1280 })
  person = makeUser()
  auth.value = { isClerkEnabled: true, userRole: 'admin', currentUser: { id: 99, my_pay_preview_enabled: true } }
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (endpoint: string) => {
    if (endpoint === '/api/v1/admin/users/7') return { data: { user: person }, status: 200 }
    if (endpoint.startsWith('/api/v1/payroll_periods')) return { data: { periods: states, current_start_date: '2026-11-01' }, status: 200 }
    return { error: 'Not found', status: 404 }
  })
  apiMock.getTimeEntries.mockResolvedValue({ data: { time_entries: [makeEntry(), makeEntry({ id: 20, work_date: '2026-10-20' })], pagination: { total_pages: 1 } } })
  apiMock.getTimeEntry.mockResolvedValue({ data: { time_entry: makeEntry() } })
  apiMock.getHoursReport.mockResolvedValue({ data: { employees: [] } })
  apiMock.getTimeCategories.mockResolvedValue({ data: { time_categories: [{ id: 1, name: 'Instruction' }] } })
  apiMock.getPayrollCutoff.mockResolvedValue({ data: { cutoff: null } })
  apiMock.getLeaveRequests.mockResolvedValue({ data: { leave_requests: [], pagination: { total_pages: 1 } } })
  apiMock.getMyPayAccess.mockResolvedValue({ data: { enabled_for_all: false, enabled_user_ids: [] } })
  apiMock.setUserMyPay.mockResolvedValue({ data: { user_id: 7, my_pay_enabled: true, my_pay_active: true } })
  evidenceMock.activity.mockResolvedValue({ audit_logs: [], pagination: { total_pages: 1 } })
  evidenceMock.periods.mockResolvedValue({
    employee: { id: '7', payroll_integration_id: 'employee-uuid' }, integration: { source_instance_id: 'installation-uuid' },
    as_of: '2026-11-14T02:00:00Z', totals, periods: [openPeriod, paidPeriod, lockedPeriod], evidence_note: '', pagination: { per_page: 12, total_count: 3, next_cursor: null },
  })
  evidenceMock.period.mockImplementation(async (_id: string, periodId: string) => ({
    period: { ...[openPeriod, paidPeriod, lockedPeriod].find((row) => row.id === periodId)!, entries: [], coverage_lines: [], settlement_cases: [] },
    employee: { id: '7', payroll_integration_id: 'employee-uuid' }, integration: { source_instance_id: 'installation-uuid' },
  }))
  stubsMock.workers.mockResolvedValue({ workers: [{ id: 7, name: 'Casey Cruz', first_name: 'Casey', role: 'employee', on_file_email: 'casey@aire.test' }], can_choose_recipient: true })
  stubsMock.statements.mockResolvedValue({ statements: [{ id: 's1', pay_date: '2026-11-10', period_start: '2026-10-16', period_end: '2026-10-31', voided: false }] })
})

afterEach(() => {
  restoreMedia()
  vi.useRealTimers()
})

describe('old tab keys', () => {
  it.each([
    ['hours', 'Time', 'time'],
    ['schedule', 'Time', 'time'],
    ['setup', 'Access', 'access'],
    ['activity', 'Overview', 'overview'],
    ['time', 'Time', 'time'],
    ['nonsense', 'Overview', 'nonsense'],
  ])('?tab=%s opens %s', async (key, label, rewritten) => {
    open(`/admin/users/7?tab=${key}`)
    await screen.findByRole('heading', { level: 1, name: 'Casey Cruz' })
    expect(selectedTab()).toHaveTextContent(label)
    await waitFor(() => expect(address().searchParams.get('tab')).toBe(rewritten))
  })

  it('scrolls an old Activity link to Recent activity', async () => {
    const scrollIntoView = vi.fn()
    const original = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    try {
      evidenceMock.activity.mockResolvedValue({ audit_logs: [{ id: 1, summary: 'Chels Santos turned on My Pay for Casey Cruz', occurred_at: '2026-11-13T01:00:00Z' }], pagination: { total_pages: 1 } })
      open('/admin/users/7?tab=activity')
      expect(await screen.findByText('Chels Santos turned on My Pay for Casey Cruz')).toBeInTheDocument()
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
      expect(scrollIntoView.mock.contexts[0]).toHaveAttribute('id', 'activity')
      expect(screen.getByRole('link', { name: 'All activity' })).toHaveAttribute('href', expect.stringContaining('/admin/activity?subject_type=User&subject_id=7'))
    } finally {
      HTMLElement.prototype.scrollIntoView = original
    }
  })
})

describe("Cornerstone Payroll's evidence link", () => {
  // Rails to_query sorts keys, and either of entry and period can be missing.
  it('lands on Time on the linked period with the shift highlighted', async () => {
    open('/admin/users/7?entry=19&period=2026-11-01&tab=hours')
    await screen.findByRole('heading', { level: 1, name: 'Casey Cruz' })
    expect(selectedTab()).toHaveTextContent('Time')
    await waitFor(() => expect(apiMock.getTimeEntries).toHaveBeenCalledWith(expect.objectContaining({ user_id: 7, start_date: '2026-10-31', end_date: '2026-11-15' })))
    await waitFor(() => expect(document.getElementById('timecard-entry-19')).toHaveClass('ring-cyan-400'))
    await waitFor(() => expect(address().searchParams.get('tab')).toBe('time'))
    expect(address().searchParams.get('entry')).toBe('19')
    expect(address().searchParams.get('period')).toBe('2026-11-01')
    expect(screen.getByRole('button', { name: /Previous pay period/ })).toBeInTheDocument()
  })

  it('finds the period from the shift when the link has no period', async () => {
    apiMock.getTimeEntry.mockResolvedValue({ data: { time_entry: makeEntry({ id: 20, work_date: '2026-10-20' }) } })
    open('/admin/users/7?entry=20&tab=hours')
    await screen.findByRole('heading', { level: 1, name: 'Casey Cruz' })
    expect(selectedTab()).toHaveTextContent('Time')
    await waitFor(() => expect(apiMock.getTimeEntries).toHaveBeenCalledWith(expect.objectContaining({ start_date: '2026-10-15', end_date: '2026-10-31' })))
    expect(apiMock.getTimeEntries).not.toHaveBeenCalledWith(expect.objectContaining({ start_date: '2026-10-31' }))
    await waitFor(() => expect(document.getElementById('timecard-entry-20')).toHaveClass('ring-cyan-400'))
  })

  it('opens the linked period without a shift', async () => {
    open('/admin/users/7?period=2026-10-16&tab=hours')
    await screen.findByRole('heading', { level: 1, name: 'Casey Cruz' })
    expect(selectedTab()).toHaveTextContent('Time')
    await waitFor(() => expect(apiMock.getTimeEntries).toHaveBeenCalledWith(expect.objectContaining({ start_date: '2026-10-15', end_date: '2026-10-31' })))
    await waitFor(() => expect(document.getElementById('timecard-entry-20')).toBeInTheDocument())
    expect(document.getElementById('timecard-entry-20')).not.toHaveClass('ring-cyan-400')
    expect(apiMock.getTimeEntry).not.toHaveBeenCalled()
  })

  it('opens this pay period for a bare hours link', async () => {
    open('/admin/users/7?tab=hours')
    await screen.findByRole('heading', { level: 1, name: 'Casey Cruz' })
    expect(selectedTab()).toHaveTextContent('Time')
    await waitFor(() => expect(apiMock.getTimeEntries).toHaveBeenCalledWith(expect.objectContaining({ start_date: '2026-10-31', end_date: '2026-11-15' })))
  })

  it("says so when the linked shift is someone else's", async () => {
    apiMock.getTimeEntry.mockResolvedValue({ data: { time_entry: makeEntry({ user: { id: 8, email: 'x@aire.test', display_name: 'Other', full_name: 'Other' } }) } })
    open('/admin/users/7?entry=19&period=2026-11-01&tab=hours')
    expect(await screen.findByText("The linked shift belongs to someone else, so it isn't on this timecard.")).toBeInTheDocument()
    await waitFor(() => expect(document.getElementById('timecard-entry-19')).toBeInTheDocument())
    expect(document.getElementById('timecard-entry-19')).not.toHaveClass('ring-cyan-400')
  })

  it("keeps Payroll's start_date links on that period", async () => {
    open('/admin/users/7?tab=hours&start_date=2026-09-03&end_date=2026-09-03')
    await screen.findByRole('heading', { level: 1, name: 'Casey Cruz' })
    await waitFor(() => expect(apiMock.getTimeEntries).toHaveBeenCalledWith(expect.objectContaining({ start_date: '2026-08-31', end_date: '2026-09-15' })))
  })
})

describe('person page', () => {
  it("says it couldn't find an unknown person and links back to Team", async () => {
    open('/admin/users/404')
    expect(await screen.findByText("We couldn't find that person.")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Team' })).toHaveAttribute('href', '/admin/users')
  })

  it('treats a malformed id as unknown without asking the API', async () => {
    open('/admin/users/7abc')
    expect(await screen.findByText("We couldn't find that person.")).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/v1/admin/users/7abc')
  })

  it('heads the page with the person, their pills and actions', async () => {
    person = makeUser({ my_pay_enabled: true, personal_access_enabled: false, email: null })
    open('/admin/users/7?return_to=%2Fadmin%2Fusers%3Fsearch%3DCasey')
    expect(await screen.findByRole('heading', { level: 1, name: 'Casey Cruz' })).toBeInTheDocument()
    expect(screen.getByText('Certified Flight Instructor · CFI · Employee')).toBeInTheDocument()
    const pills = screen.getByRole('list', { name: 'Status' })
    expect(within(pills).getByText('Active')).toBeInTheDocument()
    expect(within(pills).getByText('My Pay on')).toBeInTheDocument()
    expect(within(pills).getByText('Kiosk only')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Team' })).toHaveAttribute('href', '/admin/users?search=Casey')
    expect(screen.getByRole('tablist', { name: 'Casey Cruz' })).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Overview', 'Time', 'Pay', 'Access', 'Employment'])

    fireEvent.click(screen.getByRole('button', { name: 'More for Casey Cruz' }))
    expect(await screen.findByRole('menuitem', { name: /Preview their My Pay/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Reset kiosk PIN/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Open in Timecards/ })).toBeInTheDocument()
  })

  it('leaves Preview their My Pay out for admins off the preview allowlist', async () => {
    auth.value = { isClerkEnabled: true, userRole: 'admin', currentUser: { id: 99, my_pay_preview_enabled: false } }
    open('/admin/users/7')
    await screen.findByRole('heading', { level: 1, name: 'Casey Cruz' })
    fireEvent.click(screen.getByRole('button', { name: 'More for Casey Cruz' }))
    expect(await screen.findByRole('menuitem', { name: /Reset kiosk PIN/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Preview their My Pay/ })).not.toBeInTheDocument()
  })

  it('opens the Send stub dialog for this person with the #168 recipient rules', async () => {
    open('/admin/users/7')
    await screen.findByRole('heading', { level: 1, name: 'Casey Cruz' })
    fireEvent.click(screen.getByRole('button', { name: 'Send stub' }))
    const dialog = await screen.findByRole('dialog', { name: 'Send a pay stub' })
    // Pay dates only, never amounts; owners and admins may send to an address that isn't on file.
    await waitFor(() => expect(stubsMock.statements).toHaveBeenCalledWith(7, expect.anything()))
    expect((await within(dialog).findAllByText('casey@aire.test')).length).toBeGreaterThan(0)
    expect(within(dialog).getByRole('radio', { name: /Email on file/ })).toBeChecked()
    expect(dialog).not.toHaveTextContent('$')
    expect(stubsMock.send).not.toHaveBeenCalled()
  })

  it('opens the Edit dialog on Team from Access and Employment', async () => {
    open('/admin/users/7?tab=access')
    await screen.findByRole('heading', { level: 1, name: 'Casey Cruz' })
    const access = screen.getByRole('region', { name: 'Access' })
    expect(access).toHaveTextContent('Employee')
    expect(access).toHaveTextContent('casey@aire.test')
    const edit = within(access).getByRole('link', { name: 'Edit' })
    expect(edit).toHaveAttribute('href', expect.stringMatching(/^\/admin\/users\?edit_user_id=7&return_to=/))

    fireEvent.click(screen.getByRole('tab', { name: 'Employment' }))
    const setup = await screen.findByRole('region', { name: 'Work setup' })
    expect(setup).toHaveTextContent('Instruction')
    expect(within(setup).getByRole('link', { name: 'Edit' })).toHaveAttribute('href', expect.stringContaining('edit_user_id=7'))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('resends an invite from Access and reports the actual outcome', async () => {
    person = makeUser({ is_pending: true, employment_status: 'pending', has_clerk_account: false })
    apiMock.resendInvite.mockResolvedValueOnce({ data: { invitation_email_sent: false, invitation_email_captured: true, message: 'Invitation captured in staging; no email was sent.' } })
    open('/admin/users/7?tab=access')
    fireEvent.click(await screen.findByRole('button', { name: 'Resend invite' }))
    expect(await screen.findByText(/Captured in staging \(not sent\)/)).toBeInTheDocument()
    expect(apiMock.resendInvite).toHaveBeenCalledWith(7)
  })

  it('deletes an unused profile only after the in-app confirmation', async () => {
    person = makeUser({ can_delete_permanently: true })
    apiMock.deleteUser.mockResolvedValue({})
    open('/admin/users/7?tab=access')
    fireEvent.click(await screen.findByRole('button', { name: 'Delete unused profile' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete the unused profile for Casey Cruz?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(apiMock.deleteUser).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete unused profile' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete profile' }))
    await waitFor(() => expect(apiMock.deleteUser).toHaveBeenCalledWith(7))
    await waitFor(() => expect(address().pathname).toBe('/admin/users'))
  })
})

describe('Pay tab', () => {
  it('turns My Pay on and shows it in the header', async () => {
    open('/admin/users/7?tab=pay')
    const toggle = await screen.findByRole('switch', { name: 'My Pay' })
    await waitFor(() => expect(toggle).toBeEnabled())
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(toggle)
    await waitFor(() => expect(apiMock.setUserMyPay).toHaveBeenCalledWith(7, true))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'My Pay' })).toHaveAttribute('aria-checked', 'true'))
    expect(within(screen.getByRole('list', { name: 'Status' })).getByText('My Pay on')).toBeInTheDocument()
  })

  it("reports a failed My Pay change without pretending it changed", async () => {
    apiMock.setUserMyPay.mockResolvedValueOnce({ error: 'Only owners and admins can change My Pay access' })
    open('/admin/users/7?tab=pay')
    const toggle = await screen.findByRole('switch', { name: 'My Pay' })
    await waitFor(() => expect(toggle).toBeEnabled())
    fireEvent.click(toggle)
    expect(await screen.findByRole('alert')).toHaveTextContent('Only owners and admins can change My Pay access')
    expect(screen.getByRole('switch', { name: 'My Pay' })).toHaveAttribute('aria-checked', 'false')
  })

  it('says My Pay is on for everyone instead of a switch', async () => {
    apiMock.getMyPayAccess.mockResolvedValue({ data: { enabled_for_all: true, enabled_user_ids: [] } })
    open('/admin/users/7?tab=pay')
    expect(await screen.findByText(/My Pay is on for everyone/)).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'My Pay' })).not.toBeInTheDocument()
  })

  it('lists pay periods in the glossary words and hides not-matched hours until after payday', async () => {
    open('/admin/users/7?tab=pay')
    const periods = await screen.findByRole('region', { name: 'Pay periods' })
    await waitFor(() => expect(periods).toHaveTextContent('Nov 1–15'))
    const rows = within(periods).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Open · 51.5h approved · 11.5h waiting')
    // The open period has 51.5h "needs reconciliation" in the evidence; it isn't shown.
    expect(rows[0]).not.toHaveTextContent('Not matched')
    expect(rows[0]).not.toHaveTextContent(/reconciliation/i)
    expect(within(rows[0]).queryByRole('button', { name: 'Technical details' })).not.toBeInTheDocument()
    expect(rows[1]).toHaveTextContent('Paid Nov 10 · 80.5h approved')
    expect(within(rows[1]).getByText('Not matched to a paycheck yet · 2.0h')).toBeInTheDocument()
    expect(rows[2]).not.toHaveTextContent('Not matched')
    expect(screen.queryByText(/Needs reconciliation/)).not.toBeInTheDocument()
  })

  it('shows not-matched hours on a locked period only once payday has passed', async () => {
    fetchMock.mockImplementation(async (endpoint: string) => {
      if (endpoint === '/api/v1/admin/users/7') return { data: { user: person }, status: 200 }
      return { data: { periods: [{ ...states[1], handoff_state: 'locked', pay_date: '2026-11-20' }], current_start_date: '2026-11-01' }, status: 200 }
    })
    open('/admin/users/7?tab=pay')
    const periods = await screen.findByRole('region', { name: 'Pay periods' })
    await waitFor(() => expect(periods).toHaveTextContent('Locked for payroll · 80.5h approved'))
    expect(periods).not.toHaveTextContent('Not matched')
    fireEvent.click(within(periods).getAllByRole('button', { name: 'Technical details' })[0])
    expect(await within(periods).findByText('Paid (confirmed by Payroll)')).toBeInTheDocument()
    expect(within(periods).queryByText('Not matched to a paycheck yet')).not.toBeInTheDocument()
  })

  it('opens technical details for a locked period with the old evidence totals in plain words', async () => {
    open('/admin/users/7?tab=pay')
    const periods = await screen.findByRole('region', { name: 'Pay periods' })
    await waitFor(() => expect(periods).toHaveTextContent('Oct 16–31'))
    const paidRow = within(periods).getAllByRole('listitem')[1]
    fireEvent.click(within(paidRow).getByRole('button', { name: 'Technical details' }))
    expect(await within(paidRow).findByText('Paid (confirmed by Payroll)')).toBeInTheDocument()
    expect(within(paidRow).getByText('Not matched to a paycheck yet')).toBeInTheDocument()
    expect(within(paidRow).queryByText('Issued source coverage')).not.toBeInTheDocument()
    await waitFor(() => expect(evidenceMock.period).toHaveBeenCalledWith('7', '2026-10-16', expect.any(URLSearchParams), expect.anything()))
  })

  it('lists paychecks by pay date with no amounts', async () => {
    open('/admin/users/7?tab=pay')
    const paychecks = await screen.findByRole('region', { name: 'Paychecks' })
    expect(await within(paychecks).findByText('Paid Nov 10')).toBeInTheDocument()
    expect(paychecks).toHaveTextContent('Oct 16–31')
    expect(within(paychecks).getByRole('link', { name: 'Preview their My Pay' })).toHaveAttribute('href', '/admin/pay-preview/7')
  })
})

describe('break-ui names', () => {
  it.each([LONG_NAME, 'Tåsi', 'Ña'])('keeps %s whole in the header', async (name) => {
    const [first, ...rest] = name.split(' ')
    person = makeUser({ full_name: name, display_name: name, first_name: first, last_name: rest.join(' ') || null })
    open('/admin/users/7')
    const heading = await screen.findByRole('heading', { level: 1, name })
    expect(heading).toHaveClass('[overflow-wrap:anywhere]')
    expect(heading.className).not.toMatch(/truncate/)
    expect(screen.getByRole('tablist', { name })).toBeInTheDocument()
  })

  it('names the long-named person in full on Time', async () => {
    person = makeUser({ full_name: LONG_NAME, display_name: LONG_NAME, first_name: 'Joaquin' })
    open('/admin/users/7?tab=time')
    expect(await screen.findByRole('region', { name: `${LONG_NAME}'s timecard` })).toBeInTheDocument()
  })
})

describe('managers', () => {
  it('are denied the person page, as they are Team', async () => {
    auth.value = { isClerkEnabled: true, userRole: 'manager', currentUser: { id: 11 }, isLoading: false, isStaff: true, authError: null, isAuthServiceUnavailable: false } as typeof auth.value
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/admin/users/7?entry=19&period=2026-11-01&tab=hours']}>
          <Routes>
            <Route path="/admin/users/:id" element={<ClerkProtectedContent requiredCapability="manage_users"><Person /></ClerkProtectedContent>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    )
    expect(await screen.findByText('Access Denied')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Casey Cruz' })).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    // App mounts the person page and Team behind the same capability.
    expect(appSource).toMatch(/path="users\/:id" element={<ProtectedRoute requiredCapability="manage_users">/)
  })
})
