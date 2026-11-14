import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import RolesAccess from './RolesAccess'
import type { AccessGuideResponse } from '../../lib/api'
import { capabilitiesFor, USER_ROLES, type Capability } from '../../lib/roles'
// Written by the backend (spec/services/access_guide_spec.rb) from
// User::ROLE_CAPABILITIES and the role rules: an owner viewing, default settings.
import guideFixture from '../../test/fixtures/access-guide.json'

const fixture = guideFixture as unknown as AccessGuideResponse

const apiMock = vi.hoisted(() => ({ getAccessGuide: vi.fn(), getUsers: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: apiMock }))
const authMock = vi.hoisted(() => ({
  value: { isClerkEnabled: true, userRole: 'admin' as string | null, currentUser: null as null | { id: number; my_pay_enabled?: boolean } },
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => authMock.value }))

function guideAs(role: string, overrides: Partial<AccessGuideResponse> = {}): AccessGuideResponse {
  const full = role === 'owner' || role === 'admin'
  const guide: AccessGuideResponse = structuredClone(fixture)
  guide.viewer = { role, can_see_members: full, can_change_settings: full }
  if (full) {
    const names: Record<string, string[]> = {
      owner: ['Leon Owner'],
      admin: ['Chels Admin'],
      manager: ['Roke Manager'],
      employee: ['Ethan Cruz', 'Grace Torres', 'Rosa Leon Guerrero', 'Tasi Unpingco', 'Kai Blas', 'Uma Unused', 'Ana Santos', 'Joe Perez', 'Mia Reyes', 'Noah Quinata'],
    }
    guide.roles = guide.roles.map((card) => ({ ...card, members: names[card.key].map((name, index) => ({ id: index + 1, name })) }))
  } else {
    for (const card of guide.roles) delete card.members
    for (const effect of guide.settings) delete effect.individual_count
  }
  return { ...guide, ...overrides }
}

async function renderAs(role: string, overrides: Partial<AccessGuideResponse> = {}) {
  apiMock.getAccessGuide.mockResolvedValue({ data: guideAs(role, overrides) })
  render(<RolesAccess />, { wrapper: MemoryRouter })
  // The loading state has its own h1, so wait for the loading status to go first.
  await waitFor(() => expect(screen.queryByText('Loading roles…')).toBeNull())
  return screen.getByRole('heading', { level: 1 })
}

// Reads the side-by-side table back into { capability: [roles allowed] }.
function matrixFromTable() {
  const table = screen.getByRole('table', { name: 'What each role can do' })
  const headers = within(table).getAllByRole('columnheader').map((cell) => cell.textContent)
  const roleColumns = headers.slice(1)
  const matrix: Record<string, string[]> = {}
  for (const row of within(table).getAllByRole('row').slice(1)) {
    const label = within(row).getByRole('rowheader').querySelector('span > span')?.textContent ?? ''
    const key = fixture.rows.find((candidate) => candidate.label === label)?.key
    if (!key || fixture.rows.find((candidate) => candidate.key === key)?.kind !== 'capability') continue
    const cells = within(row).getAllByRole('cell')
    matrix[key] = roleColumns
      .filter((_, index) => cells[index].textContent?.startsWith('Yes'))
      .map((header) => USER_ROLES.find((role) => role === header?.toLowerCase())!)
  }
  return matrix
}

describe('Roles & access', () => {
  beforeEach(() => {
    apiMock.getAccessGuide.mockReset()
    apiMock.getUsers.mockReset()
    apiMock.getUsers.mockResolvedValue({ data: { users: [] } })
    authMock.value.userRole = 'admin'
    authMock.value.currentUser = null
  })

  it('titles the page for the signed-in role while it loads', () => {
    apiMock.getAccessGuide.mockReturnValue(new Promise(() => {}))
    const { unmount } = render(<RolesAccess />, { wrapper: MemoryRouter })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Roles & access')
    expect(screen.getByRole('status')).toHaveTextContent('Loading roles')
    unmount()
    authMock.value.userRole = 'employee'
    render(<RolesAccess />, { wrapper: MemoryRouter })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('What can I do?')
  })

  it("shows a capability grid that equals User::ROLE_CAPABILITIES and the frontend's copy of it", async () => {
    await renderAs('owner')
    const matrix = matrixFromTable()

    expect(matrix).toEqual(fixture.role_capabilities)
    const frontendCopy = Object.fromEntries(
      (Object.keys(fixture.role_capabilities) as Capability[]).map((capability) => [capability, USER_ROLES.filter((role) => capabilitiesFor(role)[capability])]),
    )
    expect(frontendCopy).toEqual(fixture.role_capabilities)
    expect(Object.keys(capabilitiesFor('owner')).sort()).toEqual(Object.keys(fixture.role_capabilities).sort())
  })

  it('gives owners and admins one card per role with who has it, what it can and can\'t do, and who gives it', async () => {
    expect(await renderAs('admin')).toHaveTextContent('Roles & access')

    const owner = screen.getByRole('article', { name: 'Owner' })
    expect(within(owner).getByText('Who has it (1)')).toBeInTheDocument()
    expect(within(owner).getByText('Leon Owner')).toBeInTheDocument()
    expect(within(owner).getByText('Who can give this role').nextSibling).toHaveTextContent('Owners')
    expect(within(owner).getByText("Change an owner's or admin's access")).toBeInTheDocument()

    const admin = screen.getByRole('article', { name: /^Admin/ })
    expect(within(admin).getByText('Your role')).toBeInTheDocument()
    const adminCant = within(admin).getByRole('heading', { name: "Can't" }).nextElementSibling as HTMLElement
    expect(within(adminCant).getByText("Change an owner's or admin's access")).toBeInTheDocument()
    expect(within(admin).getByText(': Manager or Employee only')).toBeInTheDocument()

    const manager = screen.getByRole('article', { name: 'Manager' })
    expect(within(manager).getByText('Who can give this role').nextSibling).toHaveTextContent('Owners and admins')

    const employee = screen.getByRole('article', { name: 'Employee' })
    expect(within(employee).getByText('Who has it (10)')).toBeInTheDocument()
    expect(within(employee).getByText('and 2 more')).toBeInTheDocument()
    expect(within(employee).getByText('Signs in personally, or uses the kiosk only')).toBeInTheDocument()

    expect(screen.getByRole('link', { name: 'Back to Settings' })).toHaveAttribute('href', '/admin/settings')
  })

  it('shows the self-approval rule and points the manager cell at the setting that decides it', async () => {
    await renderAs('owner')
    const table = screen.getByRole('table', { name: 'What each role can do' })
    const row = within(table).getByText('Approve their own time').closest('tr')!
    const cells = within(row).getAllByRole('cell')
    expect(cells.map((cell) => cell.textContent?.slice(0, 3))).toEqual(['Yes', 'Yes', 'Yes', 'No'])
    expect(within(cells[2]).getByText('While the setting is on')).toBeInTheDocument()
    const mark = within(cells[2]).getByRole('link', { name: 'Note 1: Managers can approve their own time' })
    expect(mark).toHaveAttribute('href', '#setting-managers_can_approve_own_time')
    expect(within(cells[0]).queryByRole('link')).toBeNull()

    const note = document.getElementById('setting-managers_can_approve_own_time')!
    expect(note).toHaveTextContent('Managers can approve their own timeOn')
    expect(note).toHaveTextContent('Managers approve their own time.')
    expect(within(note).getByRole('link', { name: 'Settings → Time approvals' })).toHaveAttribute('href', '/admin/settings/approvals')
  })

  it('covers My Pay and the pay stub switches', async () => {
    await renderAs('owner')
    for (const id of ['my_pay_enabled_for_all', 'pay_stub_kiosk_requests_enabled', 'pay_stub_self_email_enabled']) {
      expect(document.getElementById(`setting-${id}`)).toHaveTextContent('Off')
    }
    expect(document.getElementById('setting-my_pay_enabled_for_all')).toHaveTextContent('0 people have it on individually.')
  })

  it('gives managers a read-only "What can I do?" view with their own role first', async () => {
    expect(await renderAs('manager')).toHaveTextContent('What can I do?')
    expect(screen.getByText(/You're a Manager/)).toBeInTheDocument()

    const cards = screen.getAllByRole('article')
    expect(cards[0]).toHaveAccessibleName(/^Manager/)
    expect(within(cards[0]).getByText('Your role')).toBeInTheDocument()
    expect(screen.queryByText(/^Who has it/)).toBeNull()
    expect(screen.queryByRole('link', { name: 'Back to Settings' })).toBeNull()

    const note = document.getElementById('setting-managers_can_approve_own_time')!
    expect(note).toHaveTextContent('Owners and admins change this in Settings → Time approvals.')
    expect(within(note).queryByRole('link')).toBeNull()
  })

  it('gives employees a short help page, naming their department managers', async () => {
    authMock.value.userRole = 'employee'
    authMock.value.currentUser = { id: 5, my_pay_enabled: true }
    apiMock.getUsers.mockResolvedValue({
      data: {
        users: [
          { id: 5, role: 'employee', is_active: true, first_name: 'Ethan', full_name: 'Ethan Cruz', approval_group_keys: ['cfi'] },
          { id: 7, role: 'manager', is_active: true, first_name: 'Roke', full_name: 'Roke Aguon', approval_group_keys: ['cfi'] },
          { id: 8, role: 'manager', is_active: true, first_name: 'Mindy', full_name: 'Mindy Diaz', approval_group_keys: ['cfi', 'ops'] },
          { id: 9, role: 'manager', is_active: true, first_name: 'Caleb', full_name: 'Caleb Ops', approval_group_keys: ['ops'] },
        ],
      },
    })
    render(<RolesAccess />, { wrapper: MemoryRouter })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('What can I do?')
    expect(await screen.findByText('Ask Roke or Mindy.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Clock' })).toHaveAttribute('href', '/admin/my-time')
    expect(screen.getByRole('heading', { name: 'Fix a shift' }).parentElement).toHaveTextContent('Go to Hours, tap the shift, then Ask for a fix.')
    expect(screen.getByRole('link', { name: 'Hours' })).toHaveAttribute('href', '/admin/my-hours')
    expect(screen.getByRole('link', { name: 'Leave' })).toHaveAttribute('href', '/admin/leave')
    expect(screen.getByRole('link', { name: 'My Pay' })).toHaveAttribute('href', '/admin/pay')
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByText(/Can't/)).toBeNull()
    expect(apiMock.getAccessGuide).not.toHaveBeenCalled()
  })

  it('leaves My Pay out of the help page while it is off, and falls back to "your manager"', async () => {
    authMock.value.userRole = 'employee'
    authMock.value.currentUser = { id: 5, my_pay_enabled: false }
    render(<RolesAccess />, { wrapper: MemoryRouter })
    expect(await screen.findByText('Ask your manager.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'My Pay' })).toBeNull()
  })

  it('lists the rules that always apply', async () => {
    await renderAs('owner')
    const rules = screen.getByRole('region', { name: 'Rules that always apply' })
    expect(rules).toHaveTextContent('Nobody can change their own role.')
    expect(rules).toHaveTextContent('at least one active owner who signs in')
  })

  it('explains a failed load and tries again', async () => {
    const user = userEvent.setup()
    apiMock.getAccessGuide.mockResolvedValueOnce({ error: 'Network down' }).mockResolvedValueOnce({ data: guideAs('owner') })
    render(<RolesAccess />, { wrapper: MemoryRouter })
    expect(await screen.findByRole('alert')).toHaveTextContent('Network down')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('table', { name: 'What each role can do' })).toBeInTheDocument()
  })
})
