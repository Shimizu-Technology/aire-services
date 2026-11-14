import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { AdminUser } from '../../lib/api'
import { TeamList } from './TeamList'

const LONG_NAME = 'Joaquin Mendiola-Taitano De Leon Guerrero'

function person(id: number, name: string, overrides: Partial<AdminUser> = {}) {
  return {
    id, full_name: name, display_name: name, first_name: name.split(' ')[0], last_name: null, email: `${id}@aire.test`, role: 'employee',
    approval_group_labels: ['Ops/Maint'], is_active: true, employment_status: 'active', personal_access_enabled: true,
    time_tracking_enabled: true, kiosk_enabled: true, kiosk_locked_until: null, is_pending: false,
    ...overrides,
  } as AdminUser
}

function Address() { return <output aria-label="Address">{useLocation().pathname}</output> }

function renderList(users: AdminUser[], onTheClock = new Set<number>(), myPay?: (user: AdminUser) => React.ReactNode) {
  render(<MemoryRouter><TeamList users={users} onTheClock={onTheClock} returnTo="/admin/users?search=a" myPay={myPay} /><Address /></MemoryRouter>)
}

const rowFor = (name: string) => screen.getByRole('link', { name }).closest('[role="listitem"]') as HTMLElement

describe('TeamList', () => {
  it('keeps a 40-character Chamorro surname and Tåsi whole and wrapping, not cut off', () => {
    renderList([person(1, LONG_NAME, { personal_access_enabled: false }), person(2, 'Tåsi'), person(3, 'Ña')])
    const long = screen.getByRole('link', { name: LONG_NAME })
    expect(long).toHaveTextContent(LONG_NAME)
    expect(long).toHaveClass('whitespace-normal', '[overflow-wrap:anywhere]')
    expect(rowFor(LONG_NAME)).toHaveTextContent('Employee · Ops/Maint · kiosk only')
    expect(screen.getByRole('link', { name: 'Tåsi' })).toHaveAttribute('href', '/admin/users/2?tab=overview&return_to=%2Fadmin%2Fusers%3Fsearch%3Da')
    // Avatars show initials for every name.
    expect(rowFor('Tåsi').querySelector('[aria-hidden="true"]')).toHaveTextContent('T')
  })

  it('shows at most one state, the one someone acts on first', () => {
    renderList([
      person(1, 'Clocked No Email', { email: null }),
      person(2, 'Locked Pin', { kiosk_locked_until: '2099-01-01T00:00:00Z' }),
      person(3, 'No Email', { email: null }),
      person(4, 'Ended Clocked', { employment_status: 'terminated', is_active: false }),
      person(5, 'Plain Person'),
    ], new Set([1, 4]))
    expect(within(rowFor('Clocked No Email')).getByText('On the clock')).toBeInTheDocument()
    expect(within(rowFor('Clocked No Email')).queryByText('No email')).not.toBeInTheDocument()
    expect(within(rowFor('Locked Pin')).getByText('PIN locked')).toBeInTheDocument()
    expect(within(rowFor('No Email')).getByText('No email')).toBeInTheDocument()
    expect(within(rowFor('Ended Clocked')).getByText('Ended')).toBeInTheDocument()
    expect(within(rowFor('Ended Clocked')).queryByText('On the clock')).not.toBeInTheDocument()
    expect(rowFor('Plain Person').querySelectorAll('[data-tone]')).toHaveLength(0)
    for (const name of ['Clocked No Email', 'Locked Pin', 'No Email', 'Ended Clocked']) {
      expect(rowFor(name).querySelectorAll('[data-tone]')).toHaveLength(1)
    }
  })

  it('opens the person from the row and leaves the switch to itself', () => {
    const onSwitch = vi.fn()
    renderList([person(4, 'Dana Cruz')], new Set(), (user) => <button type="button" role="switch" aria-checked="false" aria-label={`My Pay for ${user.full_name}`} onClick={onSwitch} />)
    fireEvent.click(screen.getByRole('switch', { name: 'My Pay for Dana Cruz' }))
    expect(onSwitch).toHaveBeenCalled()
    expect(screen.getByLabelText('Address')).toHaveTextContent('/')
    expect(screen.getByLabelText('Address')).not.toHaveTextContent('/admin/users/4')
    fireEvent.click(rowFor('Dana Cruz').querySelector('[data-list-row]')!)
    expect(screen.getByLabelText('Address')).toHaveTextContent('/admin/users/4')
  })
})
