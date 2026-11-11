import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { capabilitiesFor, type UserRole } from '../../lib/roles'
import { legacyTimeRedirect, landingPathFor } from '../../lib/adminRoutes'
import { AdminLanding, LegacyTimeRedirect, MovedPage } from './AdminRedirects'

const auth = vi.hoisted(() => ({ role: 'manager' as UserRole }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ isClerkEnabled: true, userRole: auth.role }) }))

function Probe({ name }: { name: string }) {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <div>
      <p data-testid="page">{name}</p>
      <p data-testid="url">{`${location.pathname}${location.search}${location.hash}`}</p>
      <p data-testid="state">{JSON.stringify(location.state ?? null)}</p>
      <button type="button" onClick={() => navigate(-1)}>Back</button>
      <button type="button" onClick={() => navigate(1)}>Forward</button>
      <Link to="/admin/time?tab=approvals&through_date=2026-11-15">Old approvals link</Link>
    </div>
  )
}

// The admin routes from App.tsx, with each page replaced by a probe.
function renderAt(entries: Array<string | { pathname: string; search?: string; hash?: string; state?: unknown }>, index?: number) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={index}>
      <Routes>
        <Route path="/admin">
          <Route index element={<AdminLanding><Probe name="Today" /></AdminLanding>} />
          <Route path="approvals" element={<Probe name="Approvals" />} />
          <Route path="timecards" element={<Probe name="Timecards" />} />
          <Route path="reports" element={<Probe name="Reports" />} />
          <Route path="leave" element={<Probe name="Leave" />} />
          <Route path="my-hours" element={<Probe name="My Hours" />} />
          <Route path="my-time" element={<Probe name="My Time" />} />
          <Route path="time" element={<LegacyTimeRedirect />} />
          <Route path="website/media" element={<Probe name="Website media" />} />
          <Route path="media" element={<MovedPage to="/admin/website/media" />} />
          <Route path="payroll" element={<Probe name="Payroll" />} />
          <Route path="users/:id" element={<Probe name="Person" />} />
          <Route path="pay-preview/:userId?/:id?" element={<Probe name="Pay preview" />} />
          <Route path="pay-stubs" element={<Probe name="Pay stubs" />} />
          <Route path="payroll-link" element={<Probe name="Payroll link" />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

const page = () => screen.getByTestId('page').textContent
const url = () => screen.getByTestId('url').textContent

beforeEach(() => { auth.role = 'manager' })

describe('old /admin/time links', () => {
  it.each([
    // The cutoff reminder email (Payroll::CutoffApprovalReminder).
    ['/admin/time?tab=approvals', 'Approvals', '/admin/approvals'],
    // Older dashboard, cutoff banner and payroll links carried the period.
    ['/admin/time?start_date=2026-11-01&end_date=2026-11-15&tab=approvals&through_date=2026-11-15', 'Approvals', '/admin/approvals?start_date=2026-11-01&end_date=2026-11-15&through_date=2026-11-15'],
    ['/admin/time?tab=reports&start_date=2026-11-01&end_date=2026-11-15&approval_status=denied&user_id=7', 'Reports', '/admin/reports?start_date=2026-11-01&end_date=2026-11-15&approval_status=denied&user_id=7'],
    ['/admin/time?tab=leave', 'Leave', '/admin/leave'],
    // "Fix clock-out" from Who's Working (#171).
    ['/admin/time?entry_id=55&date=2026-11-10&view=day&user_id=7', 'Timecards', '/admin/timecards?entry_id=55&date=2026-11-10&view=day&user_id=7'],
    ['/admin/time?tab=entries&view=period&start_date=2026-11-01&end_date=2026-11-15', 'Timecards', '/admin/timecards?view=period&start_date=2026-11-01&end_date=2026-11-15'],
    ['/admin/time?prefill=true&schedule_id=4&user_id=7&return_to=%2Fadmin%2Fusers%2F7', 'Timecards', '/admin/timecards?prefill=true&schedule_id=4&user_id=7&return_to=%2Fadmin%2Fusers%2F7'],
    ['/admin/time', 'Timecards', '/admin/timecards'],
    ['/admin/time?tab=bogus', 'Timecards', '/admin/timecards'],
  ])('sends a manager from %s to %s with the same query', (from, expectedPage, expectedUrl) => {
    renderAt([from])
    expect(page()).toBe(expectedPage)
    expect(url()).toBe(expectedUrl)
  })

  it.each([
    ['/admin/time', 'My Hours', '/admin/my-hours'],
    ['/admin/time?date=2026-11-10&view=day', 'My Hours', '/admin/my-hours?date=2026-11-10&view=day'],
    ['/admin/time?tab=leave', 'Leave', '/admin/leave'],
    // Employees never had approvals or reports; their own hours are the closest page.
    ['/admin/time?tab=approvals', 'My Hours', '/admin/my-hours'],
    ['/admin/time?tab=reports', 'My Hours', '/admin/my-hours'],
  ])('sends an employee from %s to %s', (from, expectedPage, expectedUrl) => {
    auth.role = 'employee'
    renderAt([from])
    expect(page()).toBe(expectedPage)
    expect(url()).toBe(expectedUrl)
  })

  it('keeps the hash and the navigation state', () => {
    renderAt([{ pathname: '/admin/time', search: '?tab=reports', hash: '#export', state: { from: 'email' } }])
    expect(url()).toBe('/admin/reports#export')
    expect(screen.getByTestId('state')).toHaveTextContent('{"from":"email"}')
  })

  it('replaces the old entry, so Back and Forward skip the redirect', async () => {
    renderAt(['/admin/payroll'])
    expect(page()).toBe('Payroll')
    await act(async () => { fireEvent.click(screen.getByRole('link', { name: 'Old approvals link' })) })
    expect(url()).toBe('/admin/approvals?through_date=2026-11-15')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Back' })) })
    expect(page()).toBe('Payroll')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Forward' })) })
    expect(url()).toBe('/admin/approvals?through_date=2026-11-15')
  })
})

describe('other moved and kept URLs', () => {
  it('moves /admin/media under Website, keeping its query', () => {
    auth.role = 'admin'
    renderAt(['/admin/media?slot=hero'])
    expect(page()).toBe('Website media')
    expect(url()).toBe('/admin/website/media?slot=hero')
  })

  it.each([
    // Cornerstone Payroll's cockpit links to the person page with these params.
    ['/admin/users/7?tab=hours&period=2026-11-01&entry=55', 'Person'],
    ['/admin/pay-preview', 'Pay preview'],
    ['/admin/pay-preview/7/12', 'Pay preview'],
    ['/admin/payroll?start_date=2026-11-01&end_date=2026-11-15', 'Payroll'],
    // Pay stub emails and the Payroll account-link handshake.
    ['/admin/pay-stubs', 'Pay stubs'],
    ['/admin/payroll-link?token=synthetic', 'Payroll link'],
  ])('keeps %s where it is', (path, expectedPage) => {
    auth.role = 'admin'
    renderAt([path])
    expect(page()).toBe(expectedPage)
    expect(url()).toBe(path)
  })
})

describe('landing page by role', () => {
  it.each([
    ['owner', 'Today', '/admin'],
    ['admin', 'Today', '/admin'],
    ['manager', 'Approvals', '/admin/approvals'],
    ['employee', 'My Time', '/admin/my-time'],
  ] as const)('opens /admin for a %s on %s', (role, expectedPage, expectedUrl) => {
    auth.role = role
    renderAt(['/admin'])
    expect(page()).toBe(expectedPage)
    expect(url()).toBe(expectedUrl)
    expect(landingPathFor(capabilitiesFor(role))).toBe(expectedUrl)
  })
})

describe('legacyTimeRedirect', () => {
  it('drops only the tab parameter', () => {
    expect(legacyTimeRedirect('?tab=approvals&approval_group=cfi&role=manager', '', capabilitiesFor('admin'))).toBe('/admin/approvals?approval_group=cfi&role=manager')
  })
})
