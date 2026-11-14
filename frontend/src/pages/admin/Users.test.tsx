import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MemoryRouter, useLocation } from 'react-router-dom'
import Users from './Users'
import type { AdminTimeCategory, AdminUser, ApprovalGroupOption } from '../../lib/api'
import { mockMatchMedia } from '../../test/matchMedia'

const apiMock = vi.hoisted(() => ({
  getAdminUsers: vi.fn(),
  getAdminTimeCategories: vi.fn(),
  getAdminAppSettings: vi.fn(),
  inviteUser: vi.fn(),
  updateUser: vi.fn(),
  terminateUser: vi.fn(),
  reactivateUser: vi.fn(),
  deleteUser: vi.fn(),
  resendInvite: vi.fn(),
  resetKioskPin: vi.fn(),
  updateUserPublicTeamPhoto: vi.fn(),
  removeUserPublicTeamPhoto: vi.fn(),
  getMyPayAccess: vi.fn(),
  setMyPayForEveryone: vi.fn(),
  setUserMyPay: vi.fn(),
  getWhosWorking: vi.fn(),
}))

vi.mock('../../lib/api', () => ({
  api: apiMock,
}))

const auth = vi.hoisted(() => ({ value: { isClerkEnabled: true, userRole: 'admin' as 'owner' | 'admin' | 'manager' | 'employee' | null, currentUser: null as { id: number; my_pay_preview_enabled?: boolean } | null } }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => auth.value }))

vi.mock('../../components/ui/MotionComponents', () => ({
  FadeUp: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

const approvalGroups: ApprovalGroupOption[] = [
  { key: 'flight', label: 'Flight' },
  { key: 'ops', label: 'Operations' },
]

const categories: AdminTimeCategory[] = [
  {
    id: 1,
    key: 'instruction',
    name: 'Instruction',
    description: null,
    is_active: true,
    time_entries_count: 0,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
  },
]

let restoreMedia = () => {}
afterEach(() => restoreMedia())

/** A Team row: the list item holding the person's name link. */
function rowFor(name: string) {
  return screen.getByRole('link', { name }).closest('[role="listitem"]') as HTMLElement
}

function openFilters() {
  fireEvent.click(screen.getByRole('button', { name: /^Filters/ }))
  return screen.getByRole('dialog', { name: 'Filters' })
}

function makeUser(overrides: Partial<AdminUser>): AdminUser {
  const user: AdminUser = {
    id: 1,
    email: 'user@example.com',
    first_name: 'Test',
    last_name: 'User',
    display_name: 'Test User',
    full_name: 'Test User',
    role: 'employee',
    staff_title: null,
    approval_group: null,
    approval_group_label: undefined,
    is_active: true,
    employment_status: 'active',
    terminated_at: null,
    termination_effective_on: null,
    termination_reason: null,
    terminated_by: null,
    can_delete_permanently: false,
    is_pending: false,
    has_clerk_account: true,
    uses_clerk_profile: true,
    personal_access_enabled: true,
    profile_source: 'clerk',
    time_tracking_enabled: true,
    public_team_enabled: false,
    public_team_name: null,
    public_team_title: null,
    public_team_sort_order: 0,
    public_team_photo_position_x: 50,
    public_team_photo_position_y: 50,
    kiosk_enabled: true,
    kiosk_pin_configured: false,
    kiosk_pin_last_rotated_at: null,
    kiosk_locked_until: null,
    time_category_ids: [1],
    time_categories: [{ id: 1, key: 'instruction', name: 'Instruction' }],
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    ...overrides,
  }
  if (!overrides.employment_status) user.employment_status = user.is_active ? (user.is_pending ? 'pending' : 'active') : 'inactive'
  return user
}

describe('Users filters', () => {
  beforeEach(() => {
    apiMock.getAdminUsers.mockReset()
    apiMock.getAdminTimeCategories.mockReset()
    apiMock.getAdminAppSettings.mockReset()
    apiMock.inviteUser.mockReset()
    apiMock.updateUser.mockReset()
    apiMock.terminateUser.mockReset()
    apiMock.reactivateUser.mockReset()

    apiMock.getAdminUsers.mockResolvedValue({
      data: {
        users: [
          makeUser({
            id: 1,
            full_name: 'Alice Pilot',
            display_name: 'Alice Pilot',
            email: 'alice@aire.test',
            staff_title: 'Certified Flight Instructor',
            approval_group: 'flight',
            approval_group_label: 'Flight',
            kiosk_pin_configured: true,
            time_category_ids: [1],
            time_categories: [{ id: 1, key: 'instruction', name: 'Instruction' }],
          }),
          makeUser({
            id: 2,
            full_name: 'Blake Ops',
            display_name: 'Blake Ops',
            email: 'blake@aire.test',
            role: 'admin',
            approval_group: 'ops',
            approval_group_label: 'Operations',
            public_team_enabled: true,
          }),
          makeUser({
            id: 3,
            full_name: 'Casey Inactive',
            display_name: 'Casey Inactive',
            email: 'casey@aire.test',
            is_active: false,
            kiosk_locked_until: '2026-05-02T00:00:00Z',
          }),
          makeUser({
            id: 4,
            full_name: 'Dana Locked',
            display_name: 'Dana Locked',
            email: 'dana@aire.test',
            kiosk_locked_until: '2099-05-02T00:00:00Z',
          }),
        ],
      },
    })
    apiMock.getAdminTimeCategories.mockResolvedValue({ data: { time_categories: categories } })
    apiMock.getAdminAppSettings.mockResolvedValue({ data: { settings: {}, approval_groups: approvalGroups } })
    apiMock.inviteUser.mockResolvedValue({ data: { user: makeUser({}), invitation_email_sent: true, kiosk_pin: null } })
    apiMock.updateUser.mockResolvedValue({ data: { user: makeUser({}) } })
    apiMock.terminateUser.mockResolvedValue({ data: { user: makeUser({ is_active: false, employment_status: 'terminated' }) } })
    apiMock.reactivateUser.mockResolvedValue({ data: { user: makeUser({}) } })
    apiMock.getMyPayAccess.mockReset()
    apiMock.setMyPayForEveryone.mockReset()
    apiMock.setUserMyPay.mockReset()
    apiMock.getMyPayAccess.mockResolvedValue({ data: { enabled_for_all: false, enabled_user_ids: [] } })
    apiMock.getWhosWorking.mockResolvedValue({ data: { workers: [] } })
    auth.value = { isClerkEnabled: true, userRole: 'admin', currentUser: null }
    restoreMedia = mockMatchMedia({ width: 1280 })
  })

  it('heads the page with Team, the active count and Add person', async () => {
    render(<MemoryRouter><Users /></MemoryRouter>)
    expect(await screen.findByRole('heading', { level: 1, name: 'Team' })).toBeInTheDocument()
    expect(screen.getByText('3 active')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add person' })).toBeInTheDocument()
    expect(screen.queryByText('Total Team Members')).not.toBeInTheDocument()
  })

  it('narrows the team by search and the Filters sheet', async () => {
    render(<MemoryRouter><Users /></MemoryRouter>)

    expect(await screen.findByText('Alice Pilot')).toBeInTheDocument()
    expect(screen.getByText('Blake Ops')).toBeInTheDocument()
    expect(screen.queryByText('Casey Inactive')).not.toBeInTheDocument()
    expect(screen.getByText('Dana Locked')).toBeInTheDocument()

    let sheet = openFilters()
    fireEvent.change(within(sheet).getByLabelText('Status'), { target: { value: 'all' } })
    expect(screen.getByText('Casey Inactive')).toBeInTheDocument()
    fireEvent.change(within(sheet).getByLabelText('Status'), { target: { value: 'active' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }))

    const search = screen.getByRole('searchbox', { name: 'Search name or email' })
    expect(search).toHaveAttribute('placeholder', 'Search name or email')
    fireEvent.change(search, { target: { value: 'instructor' } })
    expect(screen.getByText('Alice Pilot')).toBeInTheDocument()
    expect(screen.queryByText('Blake Ops')).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'blake@aire' } })
    expect(screen.getByText('Blake Ops')).toBeInTheDocument()
    expect(screen.queryByText('Alice Pilot')).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: '' } })
    sheet = openFilters()
    fireEvent.change(within(sheet).getByLabelText('Role'), { target: { value: 'admin' } })
    expect(screen.getByText('Blake Ops')).toBeInTheDocument()
    expect(screen.queryByText('Alice Pilot')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filters, 1 set' })).toBeInTheDocument()

    fireEvent.click(within(sheet).getByRole('button', { name: 'Clear all' }))
    fireEvent.change(within(sheet).getByLabelText('Department'), { target: { value: 'flight' } })
    expect(screen.getByText('Alice Pilot')).toBeInTheDocument()
    expect(screen.queryByText('Blake Ops')).not.toBeInTheDocument()

    fireEvent.click(within(sheet).getByRole('button', { name: 'Clear all' }))
    fireEvent.change(within(sheet).getByLabelText('On the website'), { target: { value: 'visible' } })
    expect(screen.getByText('Blake Ops')).toBeInTheDocument()
    expect(screen.queryByText('Alice Pilot')).not.toBeInTheDocument()

    fireEvent.click(within(sheet).getByRole('button', { name: 'Clear all' }))
    fireEvent.change(within(sheet).getByLabelText('My Pay'), { target: { value: 'on' } })
    expect(await screen.findByText('No one matches.')).toBeInTheDocument()
  })

  it('filters by sign-in type', async () => {
    apiMock.getAdminUsers.mockResolvedValue({ data: { users: [
      makeUser({ id: 1, full_name: 'Alice Pilot', display_name: 'Alice Pilot' }),
      makeUser({ id: 5, full_name: 'Kai Kiosk', display_name: 'Kai Kiosk', email: null, personal_access_enabled: false }),
    ] } })
    render(<MemoryRouter><Users /></MemoryRouter>)
    await screen.findByText('Kai Kiosk')
    const sheet = openFilters()
    fireEvent.change(within(sheet).getByLabelText('Sign-in'), { target: { value: 'kiosk' } })
    expect(screen.getByText('Kai Kiosk')).toBeInTheDocument()
    expect(screen.queryByText('Alice Pilot')).not.toBeInTheDocument()
    fireEvent.change(within(sheet).getByLabelText('Sign-in'), { target: { value: 'personal' } })
    expect(screen.getByText('Alice Pilot')).toBeInTheDocument()
    expect(screen.queryByText('Kai Kiosk')).not.toBeInTheDocument()
  })

  it('shows one state per row and opens the person from anywhere on the row', async () => {
    apiMock.getAdminUsers.mockResolvedValue({ data: { users: [
      makeUser({ id: 1, full_name: 'Alice Pilot', display_name: 'Alice Pilot', approval_group_labels: ['Ops/Maint'] }),
      makeUser({ id: 4, full_name: 'Dana Locked', display_name: 'Dana Locked', kiosk_locked_until: '2099-05-02T00:00:00Z' }),
      makeUser({ id: 5, full_name: 'Kai Kiosk', display_name: 'Kai Kiosk', email: null, personal_access_enabled: false, approval_group_labels: ['Ops/Maint'] }),
      makeUser({ id: 6, full_name: 'Ended Person', display_name: 'Ended Person', is_active: false, employment_status: 'terminated' }),
    ] } })
    apiMock.getWhosWorking.mockResolvedValue({ data: { workers: [{ user: { id: 5 }, status: 'clocked_in' }] } })
    function Address() { return <output aria-label="Address">{useLocation().pathname}</output> }
    render(<MemoryRouter initialEntries={['/admin/users?status=all']}><Users /><Address /></MemoryRouter>)
    await screen.findByText('Alice Pilot')

    expect(rowFor('Alice Pilot')).toHaveTextContent('Employee · Ops/Maint')
    expect(rowFor('Alice Pilot').querySelector('[data-tone]')).toBeNull()
    expect(rowFor('Kai Kiosk')).toHaveTextContent('Employee · Ops/Maint · kiosk only')
    // On the clock wins over No email: one pill at most.
    await waitFor(() => expect(within(rowFor('Kai Kiosk')).getByText('On the clock')).toBeInTheDocument())
    expect(within(rowFor('Kai Kiosk')).queryByText('No email')).not.toBeInTheDocument()
    expect(within(rowFor('Dana Locked')).getByText('PIN locked')).toBeInTheDocument()
    expect(within(rowFor('Ended Person')).getByText('Ended')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Alice Pilot' })).toHaveAttribute('href', expect.stringMatching(/^\/admin\/users\/1\?tab=overview/))

    fireEvent.click(rowFor('Dana Locked').querySelector('[data-list-row]')!)
    expect(screen.getByLabelText('Address')).toHaveTextContent('/admin/users/4')
  })

  it('creates a personal account without collecting a duplicate name', async () => {
    apiMock.inviteUser.mockResolvedValueOnce({ data: { user: makeUser({}), invitation_email_sent: null, kiosk_pin: null } })
    render(<MemoryRouter><Users /></MemoryRouter>)
    await screen.findByText('Alice Pilot')

    fireEvent.click(screen.getByRole('button', { name: 'Add person' }))
    expect(screen.queryByLabelText(/first name/i)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'new.pilot@example.com' } })
    fireEvent.click(screen.getByLabelText(/send invitation now/i))
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(screen.getByText(/they will choose a pin after their first sign-in/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/^kiosk pin/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/instruction/i))
    fireEvent.click(within(screen.getByRole('dialog', { name: /add team member/i })).getByRole('button', { name: /^add team member$/i }))

    expect(apiMock.inviteUser).toHaveBeenCalledWith(expect.objectContaining({
      email: 'new.pilot@example.com',
      personal_access_enabled: true,
      time_tracking_enabled: true,
      kiosk_enabled: true,
      time_category_ids: [1],
    }))
    expect(apiMock.inviteUser.mock.calls[0][0]).not.toHaveProperty('first_name')
    expect(await screen.findByText('Team member added')).toBeInTheDocument()
    expect(screen.getByText(/you can send their invitation later/i)).toBeInTheDocument()
  })

  it('creates a kiosk-only employee without requiring email', async () => {
    apiMock.inviteUser.mockResolvedValueOnce({
      data: { user: makeUser({ personal_access_enabled: false, profile_source: 'local' }), invitation_email_sent: null, kiosk_pin: '481205' },
    })
    render(<MemoryRouter><Users /></MemoryRouter>)
    await screen.findByText('Alice Pilot')

    fireEvent.click(screen.getByRole('button', { name: 'Add person' }))
    fireEvent.click(screen.getByText('Kiosk only'))
    expect(screen.queryByLabelText(/^email/i)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'Local' } })
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: 'Pilot' } })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    fireEvent.click(screen.getByLabelText(/instruction/i))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^add team member$/i }))

    expect(apiMock.inviteUser).toHaveBeenCalledWith(expect.objectContaining({
      email: undefined,
      first_name: 'Local',
      personal_access_enabled: false,
      time_tracking_enabled: true,
      kiosk_enabled: true,
      time_category_ids: [1],
    }))
    expect(await screen.findByText('481205')).toBeInTheDocument()
  })

  it('allows a personal account that does not track hours', async () => {
    render(<MemoryRouter><Users /></MemoryRouter>)
    await screen.findByText('Alice Pilot')

    fireEvent.click(screen.getByRole('button', { name: 'Add person' }))
    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'salary@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    fireEvent.click(screen.getByLabelText(/tracks work hours/i))
    fireEvent.click(screen.getByRole('button', { name: /add and send invite/i }))

    expect(apiMock.inviteUser).toHaveBeenCalledWith(expect.objectContaining({
      time_tracking_enabled: false,
      kiosk_enabled: false,
      time_category_ids: [],
    }))
    expect(await screen.findByText('Team member added')).toBeInTheDocument()
  })

  it.each([
    [{ invitation_email_sent: false, invitation_email_captured: true }, 'Captured in staging (not sent)'],
    [{ invitation_email_queued: true }, 'Invitation queued'],
    [{ invitation_email_sent: true }, 'Invitation submitted to the email provider'],
    [{ invitation_email_sent: false }, 'Invitation email failed'],
  ])('reports the actual invitation outcome when creating a user: %j', async (outcome, message) => {
    apiMock.inviteUser.mockResolvedValueOnce({ data: { user: makeUser({}), ...outcome, kiosk_pin: null } })
    render(<MemoryRouter><Users /></MemoryRouter>)
    await screen.findByText('Alice Pilot')
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }))
    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'invitee@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    fireEvent.click(screen.getByLabelText(/tracks work hours/i))
    fireEvent.click(screen.getByRole('button', { name: /add and send invite/i }))
    expect(await screen.findByText(new RegExp(message.replace(/[()]/g, '\\$&')))).toBeInTheDocument()
    if ('invitation_email_captured' in outcome) expect(screen.queryByText(/could not be sent/i)).not.toBeInTheDocument()
  })

  it('keeps the My Pay switch off the phone rows', async () => {
    restoreMedia()
    restoreMedia = mockMatchMedia({ width: 390 })
    render(<MemoryRouter><Users /></MemoryRouter>)
    await screen.findByText('Alice Pilot')
    expect(within(rowFor('Alice Pilot')).queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'My Pay on for everyone' })).toBeInTheDocument()
  })

  it.each([
    [{ invitation_email_sent: false, invitation_email_captured: true }, 'Captured in staging (not sent)'],
    [{ invitation_email_sent: true }, 'Invitation submitted to the email provider'],
    [{ invitation_email_sent: false }, 'Invitation email failed'],
  ])('reports the outcome when an edit requests an invitation: %j', async (outcome, message) => {
    apiMock.getAdminUsers.mockResolvedValue({ data: { users: [makeUser({ is_pending: true, has_clerk_account: false })] } })
    apiMock.updateUser.mockResolvedValueOnce({ data: { user: makeUser({}), ...outcome } })
    render(<MemoryRouter initialEntries={['/?status=pending&edit_user_id=1']}><Users /></MemoryRouter>)
    fireEvent.click(await screen.findByLabelText('Send invitation when these changes are saved'))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('status')).toHaveTextContent(message)
    expect(apiMock.updateUser).toHaveBeenCalledWith(1, expect.objectContaining({ send_invitation: true }))
  })

  it('keeps time tracking and kiosk access enabled when changing a user to kiosk-only', async () => {
    render(<MemoryRouter initialEntries={['/admin/users?edit_user_id=1']}><Users /></MemoryRouter>)

    const dialog = await screen.findByRole('dialog', { name: /edit alice pilot/i })
    const personalAccess = within(dialog).getByRole('checkbox', { name: /^personal sign-in/i })
    fireEvent.click(personalAccess)

    const timeTracking = within(dialog).getByRole('checkbox', { name: /^tracks work hours/i })
    expect(personalAccess).not.toBeChecked()
    expect(timeTracking).toBeChecked()
    expect(timeTracking).toBeDisabled()
    expect(within(dialog).getByText(/kiosk access is included/i)).toBeInTheDocument()
    expect(within(dialog).queryByRole('checkbox', { name: /^kiosk access/i })).not.toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: /save changes/i }))

    expect(apiMock.updateUser).toHaveBeenCalledWith(1, expect.objectContaining({
      personal_access_enabled: false,
      time_tracking_enabled: true,
      kiosk_enabled: true,
      time_category_ids: [1],
    }))
  })

  afterEach(() => vi.useRealTimers())

  it('uses the termination workflow and explains that history is preserved', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-22T15:30:00Z'))
    const terminated = makeUser({
      id: 1,
      full_name: 'Alice Pilot',
      display_name: 'Alice Pilot',
      is_active: false,
      employment_status: 'terminated',
      termination_effective_on: '2026-09-21',
      terminated_at: '2026-09-22T00:00:00Z',
    })
    apiMock.terminateUser.mockResolvedValueOnce({ data: { user: terminated } })
    render(<MemoryRouter initialEntries={['/admin/users?status=all&edit_user_id=1']}><Users /></MemoryRouter>)

    fireEvent.click(within(await screen.findByRole('dialog', { name: /edit alice pilot/i })).getByRole('button', { name: /terminate employment/i }))

    const dialog = screen.getByRole('dialog', { name: /terminate alice pilot/i })
    expect(within(dialog).getByText(/time entries, schedules, payroll trail, and historical reports stay intact/i)).toBeInTheDocument()
    await waitFor(() => expect(within(dialog).getByLabelText(/last day of employment/i)).toHaveFocus())
    expect(within(dialog).getByLabelText(/last day of employment/i)).toHaveValue('2026-09-23')
    expect(within(dialog).getByLabelText(/last day of employment/i)).toHaveAttribute('max', '2026-09-23')
    fireEvent.change(within(dialog).getByLabelText(/last day of employment/i), { target: { value: '2026-09-21' } })
    fireEvent.change(within(dialog).getByLabelText(/internal note/i), { target: { value: 'Employment ended' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /confirm termination/i }))

    await waitFor(() => expect(apiMock.terminateUser).toHaveBeenCalledWith(1, {
      effective_on: '2026-09-21',
      reason: 'Employment ended',
    }))
    await waitFor(() => expect(within(rowFor('Alice Pilot')).getByText('Ended')).toBeInTheDocument())
  })

  it('reactivates a terminated employee and updates their status in place', async () => {
    const terminated = makeUser({
      id: 1,
      full_name: 'Alice Pilot',
      display_name: 'Alice Pilot',
      email: 'alice@aire.test',
      is_active: false,
      employment_status: 'terminated',
      termination_effective_on: '2026-09-21',
      terminated_at: '2026-09-22T00:00:00Z',
    })
    const reactivated = makeUser({
      id: 1,
      full_name: 'Alice Pilot',
      display_name: 'Alice Pilot',
      email: 'alice@aire.test',
    })
    apiMock.getAdminUsers.mockResolvedValueOnce({ data: { users: [terminated] } })
    apiMock.reactivateUser.mockResolvedValueOnce({ data: { user: reactivated } })
    render(<MemoryRouter initialEntries={['/admin/users?status=all&edit_user_id=1']}><Users /></MemoryRouter>)

    expect(await screen.findByText('Ended')).toBeInTheDocument()
    fireEvent.click(within(await screen.findByRole('dialog', { name: /edit alice pilot/i })).getByRole('button', { name: /reactivate user/i }))

    await waitFor(() => expect(apiMock.reactivateUser).toHaveBeenCalledWith(1))
    await waitFor(() => expect(within(rowFor('Alice Pilot')).queryByText('Ended')).not.toBeInTheDocument())
  })

  it('reports directory errors with retry rather than a false empty team', async () => {
    apiMock.getAdminUsers.mockResolvedValueOnce({ error: 'Directory temporarily unavailable' })
    render(<MemoryRouter><Users /></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('Directory temporarily unavailable')
    expect(screen.queryByText('No team members yet.')).not.toBeInTheDocument()
    expect(screen.queryByText('Total Team Members')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText('Alice Pilot')
  })

  it('restores directory filters from the URL and links the employee with that return context', async () => {
    render(<MemoryRouter initialEntries={['/admin/users?search=Alice&status=active']}><Users /></MemoryRouter>)
    const link = await screen.findByRole('link', { name: 'Alice Pilot' })
    expect(link).toHaveAttribute('href', expect.stringContaining('return_to=%2Fadmin%2Fusers%3Fsearch%3DAlice%26status%3Dactive'))
    expect(screen.getByPlaceholderText('Search name or email')).toHaveValue('Alice')
    expect(screen.queryByText('Blake Ops')).not.toBeInTheDocument()
  })

  it('closes the create dialog on Escape and returns focus to its trigger', async () => {
    render(<MemoryRouter><Users /></MemoryRouter>)
    await screen.findByText('Alice Pilot')
    const trigger = screen.getByRole('button', { name: 'Add person' })
    trigger.focus()
    fireEvent.click(trigger)
    await screen.findByRole('dialog', { name: 'Add team member' })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('removes the edit deep link on close and preserves directory filters', async () => {
    function Address() { return <output aria-label="Directory address">{useLocation().search}</output> }
    render(<MemoryRouter initialEntries={['/admin/users?edit_user_id=1&search=Alice']}><Users /><Address /></MemoryRouter>)
    const dialog = await screen.findByRole('dialog', { name: /edit alice pilot/i })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Directory address')).toHaveTextContent('?search=Alice')
    expect(screen.getByLabelText('Directory address')).not.toHaveTextContent('edit_user_id')
  })

})

describe('Users roles and My Pay', () => {
  const owner = makeUser({ id: 10, full_name: 'Leon Owner', display_name: 'Leon Owner', email: 'leon@aire.test', role: 'owner', assignable_roles: [], can_change_access: false })
  const manager = makeUser({ id: 11, full_name: 'Roke Manager', display_name: 'Roke Manager', email: 'roke@aire.test', role: 'manager', assignable_roles: ['manager', 'employee'], can_change_access: true })
  const worker = makeUser({ id: 12, full_name: 'Ana Worker', display_name: 'Ana Worker', email: 'ana@aire.test', role: 'employee', assignable_roles: ['manager', 'employee'], can_change_access: true, my_pay_enabled: false })

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true })
    apiMock.getAdminUsers.mockResolvedValue({ data: { users: [owner, manager, worker] } })
    apiMock.getAdminTimeCategories.mockResolvedValue({ data: { time_categories: categories } })
    apiMock.getAdminAppSettings.mockResolvedValue({ data: { settings: {}, approval_groups: approvalGroups } })
    apiMock.getMyPayAccess.mockResolvedValue({ data: { enabled_for_all: false, enabled_user_ids: [] } })
    apiMock.setUserMyPay.mockResolvedValue({ data: { user_id: 12, my_pay_enabled: true, my_pay_active: true } })
    apiMock.setMyPayForEveryone.mockResolvedValue({ data: { enabled_for_all: true, enabled_user_ids: [] } })
    apiMock.updateUser.mockResolvedValue({ data: { user: worker } })
    apiMock.getWhosWorking.mockResolvedValue({ data: { workers: [] } })
    auth.value = { isClerkEnabled: true, userRole: 'admin', currentUser: { id: 99 } }
    restoreMedia = mockMatchMedia({ width: 1280 })
  })

  it('lists owners and managers with their role', async () => {
    render(<MemoryRouter><Users /></MemoryRouter>)
    await screen.findByText('Leon Owner')
    expect(within(rowFor('Leon Owner')).getByText('Owner')).toBeInTheDocument()
    expect(within(rowFor('Roke Manager')).getByText('Manager')).toBeInTheDocument()
  })

  it('offers an admin only Manager and Employee for a new team member', async () => {
    render(<MemoryRouter><Users /></MemoryRouter>)
    await screen.findByText('Leon Owner')
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }))
    const dialog = screen.getByRole('dialog', { name: /add team member/i })
    const roles = within(dialog).getAllByRole('radio').filter((radio) => radio.getAttribute('name') !== 'create-access')
    expect(roles.map((radio) => (radio as HTMLInputElement).value)).toEqual(['manager', 'employee'])
    expect(within(dialog).getByText(/Approves and corrects team time and leave/)).toBeInTheDocument()
  })

  it('offers an owner all four roles for a new team member', async () => {
    auth.value = { isClerkEnabled: true, userRole: 'owner', currentUser: { id: 10 } }
    render(<MemoryRouter><Users /></MemoryRouter>)
    await screen.findByText('Leon Owner')
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }))
    const dialog = screen.getByRole('dialog', { name: /add team member/i })
    const roles = within(dialog).getAllByRole('radio').filter((radio) => radio.getAttribute('name') !== 'create-access')
    expect(roles.map((radio) => (radio as HTMLInputElement).value)).toEqual(['owner', 'admin', 'manager', 'employee'])

    fireEvent.click(within(dialog).getByRole('radio', { name: /^Admin/ }))
    expect(within(dialog).getByRole('radio', { name: /kiosk only/i })).toBeDisabled()
  })

  it('moves an employee to manager with the picker', async () => {
    render(<MemoryRouter initialEntries={['/admin/users?edit_user_id=12']}><Users /></MemoryRouter>)
    const dialog = await screen.findByRole('dialog', { name: /edit ana worker/i })
    fireEvent.click(within(dialog).getByRole('radio', { name: /^Manager/ }))
    expect(within(dialog).getByRole('checkbox', { name: /^personal sign-in/i })).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(apiMock.updateUser).toHaveBeenCalledWith(12, expect.objectContaining({ role: 'manager' })))
  })

  it("keeps an admin from changing an owner's role or access", async () => {
    render(<MemoryRouter initialEntries={['/admin/users?edit_user_id=10']}><Users /></MemoryRouter>)
    const dialog = await screen.findByRole('dialog', { name: /edit leon owner/i })
    expect(within(dialog).queryByRole('radio', { name: /^Owner/ })).not.toBeInTheDocument()
    expect(within(dialog).getByText('Only an owner can change an owner’s or admin’s role.')).toBeInTheDocument()
    expect(within(dialog).getByRole('checkbox', { name: /^personal sign-in/i })).toBeDisabled()
    expect(within(dialog).queryByRole('button', { name: /terminate employment/i })).not.toBeInTheDocument()
  })

  it("saves an owner's profile without touching their sign-in, kiosk or PIN", async () => {
    const pendingOwner = { ...owner, time_tracking_enabled: true }
    apiMock.getAdminUsers.mockResolvedValue({ data: { users: [pendingOwner, manager, worker] } })
    apiMock.updateUser.mockResolvedValue({ data: { user: pendingOwner } })
    render(<MemoryRouter initialEntries={['/admin/users?edit_user_id=10']}><Users /></MemoryRouter>)
    const dialog = await screen.findByRole('dialog', { name: /edit leon owner/i })
    expect(within(dialog).getByRole('checkbox', { name: /^tracks work hours/i })).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(apiMock.updateUser).toHaveBeenCalled())
    const payload = apiMock.updateUser.mock.calls[0][1]
    for (const key of ['email', 'personal_access_enabled', 'time_tracking_enabled', 'kiosk_enabled', 'kiosk_pin', 'send_invitation']) {
      expect(payload).not.toHaveProperty(key)
    }
  })

  it('turns one person’s My Pay on from the list', async () => {
    render(<MemoryRouter><Users /></MemoryRouter>)
    await screen.findByText('Ana Worker')
    const toggle = await within(rowFor('Ana Worker')).findByRole('switch', { name: 'My Pay for Ana Worker' })
    await waitFor(() => expect(toggle).toBeEnabled())
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(toggle)
    await waitFor(() => expect(apiMock.setUserMyPay).toHaveBeenCalledWith(12, true))
    await waitFor(() => expect(within(rowFor('Ana Worker')).getByRole('switch', { name: 'My Pay for Ana Worker' })).toHaveAttribute('aria-checked', 'true'))
  })

  it('asks before turning My Pay on for everyone', async () => {
    render(<MemoryRouter><Users /></MemoryRouter>)
    await screen.findByText('Ana Worker')
    const everyone = await screen.findByRole('switch', { name: 'My Pay on for everyone' })
    await waitFor(() => expect(everyone).toBeEnabled())
    fireEvent.click(everyone)
    expect(apiMock.setMyPayForEveryone).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Turn on for everyone' }))
    await waitFor(() => expect(apiMock.setMyPayForEveryone).toHaveBeenCalledWith(true))
    expect(await within(rowFor('Ana Worker')).findByText('On for everyone')).toBeInTheDocument()
  })

  it('reports a failed switch without pretending it changed', async () => {
    apiMock.setUserMyPay.mockResolvedValueOnce({ error: 'Only owners and admins can change My Pay access' })
    render(<MemoryRouter><Users /></MemoryRouter>)
    await screen.findByText('Ana Worker')
    const toggle = await within(rowFor('Ana Worker')).findByRole('switch', { name: 'My Pay for Ana Worker' })
    await waitFor(() => expect(toggle).toBeEnabled())
    fireEvent.click(toggle)
    expect(await screen.findByRole('alert')).toHaveTextContent('Only owners and admins can change My Pay access')
    expect(within(rowFor('Ana Worker')).getByRole('switch', { name: 'My Pay for Ana Worker' })).toHaveAttribute('aria-checked', 'false')
  })
})
