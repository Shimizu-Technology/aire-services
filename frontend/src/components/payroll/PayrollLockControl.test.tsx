import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PayrollLockControl as LockControlState } from '../../lib/api'
import PayrollLockControl from './PayrollLockControl'

const mocks = vi.hoisted(() => ({
  role: 'admin',
  getPayrollCutoff: vi.fn(),
  changePayrollLockTime: vi.fn(),
}))
vi.mock('../../lib/api', () => ({ api: mocks }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ userRole: mocks.role, isClerkEnabled: true }) }))

function control(overrides: Partial<LockControlState> = {}): LockControlState {
  return {
    period: { id: 7, external_pay_period_id: '6c6f636b-0000-4000-8000-000000000001', start_date: '2026-11-01', end_date: '2026-11-15', pay_date: '2026-11-30' },
    publication_id: 'pub-1',
    schedule_version: 1,
    status: 'scheduled',
    cutoff_state: 'upcoming',
    cutoff_at: '2026-11-22T17:00:00+10:00',
    cutoff_source: 'policy',
    default_cutoff_at: '2026-11-22T17:00:00+10:00',
    override: null,
    earliest_cutoff_at: '2026-11-19T09:00:00+10:00',
    latest_cutoff_at: '2026-11-28T23:59:00+10:00',
    lock_now_available_at: '2026-11-16T00:00:00+10:00',
    can_change: true,
    can_lock_now: true,
    can_reset: false,
    unavailable_reason: null,
    ...overrides,
  }
}

function respondWith(state: LockControlState | null, serverNow = '2026-11-19T09:00:00+10:00') {
  mocks.getPayrollCutoff.mockResolvedValue({ data: { cutoff: { stage: 'none', now: serverNow }, lock_control: state } })
}

describe('PayrollLockControl', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-19T09:00:00+10:00'))
    mocks.role = 'admin'
    mocks.getPayrollCutoff.mockReset()
    mocks.changePayrollLockTime.mockReset()
  })
  afterEach(() => vi.useRealTimers())

  it('shows when the next lock happens and who changed it', async () => {
    respondWith(control({
      cutoff_at: '2026-11-21T12:00:00+10:00',
      cutoff_source: 'override',
      override: { action: 'change', reason: 'Thanksgiving payroll run', set_at: null, set_by_name: 'Chels', set_by_system: 'cornerstone_payroll', previous_cutoff_at: null },
      can_reset: true,
    }))
    render(<PayrollLockControl />)

    expect(await screen.findByRole('heading', { name: 'Locks Sat, Nov 21 at 12:00 PM (in 2 days)' })).toBeInTheDocument()
    expect(screen.getByText('Changed by Chels: Thanksgiving payroll run')).toBeInTheDocument()
    expect(screen.getByText('Default was Sun, Nov 22 at 5:00 PM.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Reset to default/ })).toBeInTheDocument()
  })

  it('counts down in plain language with a default lock', async () => {
    respondWith(control())
    render(<PayrollLockControl variant="compact" />)
    expect(await screen.findByRole('heading', { name: 'Locks Sun, Nov 22 at 5:00 PM (in 3 days)' })).toBeInTheDocument()
    expect(screen.queryByText(/Changed by/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Reset to default/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'About the lock time' }))
    expect(screen.getByText(/5:00 PM Guam time, 7 days after the last regular payday/)).toBeInTheDocument()
    expect(screen.getByText(/AIRE owners and admins, and Cornerstone Payroll admins/)).toBeInTheDocument()
  })

  it('counts down from the server clock rather than the device clock', async () => {
    vi.setSystemTime(new Date('2026-11-12T09:00:00+10:00'))
    respondWith(control(), '2026-11-21T17:00:00+10:00')
    render(<PayrollLockControl />)
    expect(await screen.findByRole('heading', { name: 'Locks Sun, Nov 22 at 5:00 PM (tomorrow)' })).toBeInTheDocument()
  })

  it('is hidden from managers and employees', () => {
    for (const role of ['manager', 'employee']) {
      mocks.role = role
      const { container, unmount } = render(<PayrollLockControl />)
      expect(container).toBeEmptyDOMElement()
      unmount()
    }
    expect(mocks.getPayrollCutoff).not.toHaveBeenCalled()
  })

  it('locks now only after confirming what happens to later hours and giving a reason', async () => {
    respondWith(control())
    mocks.changePayrollLockTime.mockResolvedValue({ data: { cutoff_change: { cutoff_at: '2026-11-19T09:00:00+10:00', action: 'lock_now' }, lock_control: null } })
    render(<PayrollLockControl />)
    fireEvent.click(await screen.findByRole('button', { name: 'Lock now' }))

    const dialog = screen.getByRole('dialog', { name: 'Lock hours now?' })
    expect(dialog).toHaveTextContent('AIRE locks the Nov 1–Nov 15 hours right away instead of Sun, Nov 22 at 5:00 PM.')
    expect(dialog).toHaveTextContent('Hours clocked or approved after the lock go to the next pay period as late hours.')
    fireEvent.click(screen.getAllByRole('button', { name: 'Lock now' }).at(-1)!)
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a reason for the change.')
    expect(mocks.changePayrollLockTime).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'All approvals are in' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Lock now' }).at(-1)!)
    await waitFor(() => expect(mocks.changePayrollLockTime).toHaveBeenCalledTimes(1))
    expect(mocks.changePayrollLockTime.mock.calls[0][0]).toMatchObject({
      external_pay_period_id: '6c6f636b-0000-4000-8000-000000000001', publication_id: 'pub-1', lock_action: 'lock_now', reason: 'All approvals are in',
    })
    expect(mocks.changePayrollLockTime.mock.calls[0][0]).not.toHaveProperty('cutoff_at')
    expect(await screen.findByRole('status')).toHaveTextContent('Cornerstone Payroll accepted Lock now. Updating AIRE…')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('changes the lock time within the allowed range as Guam time', async () => {
    respondWith(control())
    mocks.changePayrollLockTime.mockResolvedValue({ data: { cutoff_change: { cutoff_at: '2026-11-25T17:00:00+10:00', action: 'change' }, lock_control: null } })
    render(<PayrollLockControl />)
    fireEvent.click(await screen.findByRole('button', { name: /Change lock time/ }))

    const input = screen.getByLabelText(/New lock time/) as HTMLInputElement
    expect(input).toHaveAttribute('min', '2026-11-19T09:00')
    expect(input).toHaveAttribute('max', '2026-11-28T23:59')
    expect(input.value).toBe('2026-11-22T17:00')
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Payday moved' } })

    fireEvent.change(input, { target: { value: '2026-11-29T09:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save lock time' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a time between Thu, Nov 19 at 9:00 AM and Sat, Nov 28 at 11:59 PM.')

    fireEvent.change(input, { target: { value: '2026-11-25T17:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save lock time' }))
    await waitFor(() => expect(mocks.changePayrollLockTime).toHaveBeenCalledTimes(1))
    expect(mocks.changePayrollLockTime.mock.calls[0][0]).toMatchObject({ lock_action: 'change', cutoff_at: '2026-11-25T17:00:00+10:00', reason: 'Payday moved' })
  })

  it('keeps the dialog open with the server explanation when Payroll refuses', async () => {
    respondWith(control())
    mocks.changePayrollLockTime.mockResolvedValue({ error: "This period's lock time has already passed", status: 409 })
    render(<PayrollLockControl />)
    fireEvent.click(await screen.findByRole('button', { name: 'Lock now' }))
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Ready' } })
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Lock now' }).at(-1)!) })
    expect(await screen.findByRole('alert')).toHaveTextContent("This period's lock time has already passed")
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('explains why the time cannot change and offers no actions', async () => {
    respondWith(control({ can_change: false, can_lock_now: false, unavailable_reason: 'It is too close to payday to change the lock time' }))
    render(<PayrollLockControl />)
    expect(await screen.findByText('It is too close to payday to change the lock time.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Lock now|Change lock time/ })).not.toBeInTheDocument()
  })
})
