import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Users from './Users'
import type { AdminTimeCategory, AdminUser, ApprovalGroupOption } from '../../lib/api'

const apiMock = vi.hoisted(() => ({
  getAdminUsers: vi.fn(),
  getAdminTimeCategories: vi.fn(),
  getAdminAppSettings: vi.fn(),
  inviteUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  resendInvite: vi.fn(),
  resetKioskPin: vi.fn(),
  updateUserPublicTeamPhoto: vi.fn(),
  removeUserPublicTeamPhoto: vi.fn(),
}))

vi.mock('../../lib/api', () => ({
  api: apiMock,
}))

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
    hourly_rate_cents: 2500,
    hourly_rate: 25,
    time_entries_count: 0,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
  },
]

function makeUser(overrides: Partial<AdminUser>): AdminUser {
  return {
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
}

describe('Users filters', () => {
  beforeEach(() => {
    apiMock.getAdminUsers.mockReset()
    apiMock.getAdminTimeCategories.mockReset()
    apiMock.getAdminAppSettings.mockReset()
    apiMock.inviteUser.mockReset()
    apiMock.updateUser.mockReset()

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
  })

  it('narrows the users table by search and filters', async () => {
    render(<Users />)

    expect(await screen.findByText('Alice Pilot')).toBeInTheDocument()
    expect(screen.getByText('Blake Ops')).toBeInTheDocument()
    expect(screen.queryByText('Casey Inactive')).not.toBeInTheDocument()
    expect(screen.getByText('Dana Locked')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/status/i), { target: { value: 'all' } })
    expect(screen.getByText('Casey Inactive')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/status/i), { target: { value: 'active' } })

    fireEvent.change(screen.getByLabelText(/search/i), { target: { value: 'instructor' } })
    expect(screen.getByText('Alice Pilot')).toBeInTheDocument()
    expect(screen.queryByText('Blake Ops')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/search/i), { target: { value: 'active' } })
    expect(screen.getByText('Alice Pilot')).toBeInTheDocument()
    expect(screen.getByText('Blake Ops')).toBeInTheDocument()
    expect(screen.queryByText('Casey Inactive')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/search/i), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText(/role/i), { target: { value: 'admin' } })
    expect(screen.getByText('Blake Ops')).toBeInTheDocument()
    expect(screen.queryByText('Alice Pilot')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }))
    fireEvent.change(screen.getByLabelText(/department/i), { target: { value: 'flight' } })
    expect(screen.getByText('Alice Pilot')).toBeInTheDocument()
    expect(screen.queryByText('Blake Ops')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }))
    fireEvent.change(screen.getByLabelText(/kiosk/i), { target: { value: 'locked' } })
    const table = screen.getByRole('table')
    expect(within(table).getByText('Dana Locked')).toBeInTheDocument()
    expect(within(table).queryByText('Casey Inactive')).not.toBeInTheDocument()
    expect(within(table).queryByText('Alice Pilot')).not.toBeInTheDocument()
  })

  it('creates a personal account without collecting a duplicate name', async () => {
    apiMock.inviteUser.mockResolvedValueOnce({ data: { user: makeUser({}), invitation_email_sent: null, kiosk_pin: null } })
    render(<Users />)
    await screen.findByText('Alice Pilot')

    fireEvent.click(screen.getByRole('button', { name: /add team member/i }))
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
    render(<Users />)
    await screen.findByText('Alice Pilot')

    fireEvent.click(screen.getByRole('button', { name: /add team member/i }))
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
    render(<Users />)
    await screen.findByText('Alice Pilot')

    fireEvent.click(screen.getByRole('button', { name: /add team member/i }))
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

  it('keeps time tracking and kiosk access enabled when changing a user to kiosk-only', async () => {
    render(<Users />)

    const aliceName = await screen.findByText('Alice Pilot')
    const aliceRow = aliceName.closest('tr')
    expect(aliceRow).not.toBeNull()
    fireEvent.click(within(aliceRow!).getByRole('button', { name: /^edit$/i }))

    const dialog = screen.getByRole('dialog', { name: /edit alice pilot/i })
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
})
