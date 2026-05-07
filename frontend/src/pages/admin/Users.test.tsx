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
    uses_clerk_profile: true,
    public_team_enabled: false,
    public_team_name: null,
    public_team_title: null,
    public_team_sort_order: 0,
    kiosk_enabled: true,
    kiosk_pin_configured: false,
    kiosk_pin_last_rotated_at: null,
    kiosk_locked_until: null,
    time_category_ids: [],
    time_categories: [],
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
        ],
      },
    })
    apiMock.getAdminTimeCategories.mockResolvedValue({ data: { time_categories: categories } })
    apiMock.getAdminAppSettings.mockResolvedValue({ data: { settings: {}, approval_groups: approvalGroups } })
  })

  it('narrows the users table by search and filters', async () => {
    render(<Users />)

    expect(await screen.findByText('Alice Pilot')).toBeInTheDocument()
    expect(screen.getByText('Blake Ops')).toBeInTheDocument()
    expect(screen.getByText('Casey Inactive')).toBeInTheDocument()

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
    expect(within(table).getByText('Casey Inactive')).toBeInTheDocument()
    expect(within(table).queryByText('Alice Pilot')).not.toBeInTheDocument()
  })
})
