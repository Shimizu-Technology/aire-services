import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui'
import { mockMatchMedia } from '../../test/matchMedia'
import {
  NOW,
  allItems,
  attention,
  connection,
  cutoff,
  lockControl,
  worker,
} from '../../test/fixtures/today'
import Today from './Today'

const mocks = vi.hoisted(() => ({
  attention: vi.fn(),
  connection: vi.fn(),
  getPayrollCutoff: vi.fn(),
  getWhosWorking: vi.fn(),
  resetKioskPin: vi.fn(),
  role: 'owner',
}))
vi.mock('../../lib/api', () => ({
  api: { getPayrollCutoff: mocks.getPayrollCutoff, getWhosWorking: mocks.getWhosWorking, resetKioskPin: mocks.resetKioskPin },
}))
vi.mock('../../lib/api/people', () => ({ peopleApi: { person: vi.fn(async () => ({ data: { user: { admin_edit_version: 3 } } })), resetPin: mocks.resetKioskPin } }))
vi.mock('../../lib/api/attention', () => ({ attentionApi: { attention: mocks.attention, connection: mocks.connection } }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ userRole: mocks.role, isClerkEnabled: true }) }))

let restoreMatchMedia: () => void

async function open() {
  render(<MemoryRouter><ToastProvider><Today /></ToastProvider></MemoryRouter>)
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
}

const settle = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const rowTexts = () => within(screen.getByRole('region', { name: /Needs attention/ })).getAllByRole('listitem').map(row => row.querySelector('p')?.textContent)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date(NOW))
  restoreMatchMedia = mockMatchMedia({ width: 1280 })
  mocks.role = 'owner'
  mocks.attention.mockReset().mockResolvedValue({ data: attention() })
  mocks.connection.mockReset().mockResolvedValue({ data: connection() })
  mocks.getPayrollCutoff.mockReset().mockResolvedValue({ data: cutoff() })
  mocks.getWhosWorking.mockReset().mockResolvedValue({ data: { workers: [worker()] } })
  mocks.resetKioskPin.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  restoreMatchMedia()
})

describe('Today', () => {
  it('opens with the date, the pay period, what needs attention and who is on the clock', async () => {
    await open()
    expect(screen.getByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument()
    expect(screen.getByText('Wednesday, November 11')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Nov 1–15 pay period' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Needs attention\s+· 9/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /On the clock\s+· 1/ })).toBeInTheDocument()
    expect(document.title).toBe('Today | AIRE Ops')
  })

  it('lists attention in the API order, payroll blockers before requests', async () => {
    await open()
    expect(rowTexts()).toEqual([
      'Caleb Perez still clocked in',
      'Grace Torres on the clock 12.4h',
      '31 shifts waiting for approval',
      '6h overtime waiting',
      '2 shifts with no work category',
      'The lock failed for Nov 1–15',
      '5 leave requests waiting',
      'Kai Blas kiosk PIN locked',
      '1 pay stub request from the kiosk',
    ])
  })

  it('drops the old dashboard pieces', async () => {
    await open()
    for (const gone of ['AIRE Ops', 'Refresh snapshot', 'Refresh', 'Action Center', 'Current Team Snapshot', 'Active Right Now', 'Pending Approvals', 'Scheduled Today']) {
      expect(screen.queryByText(gone)).not.toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: /refresh/i })).not.toBeInTheDocument()
  })

  it('says nothing needs the owner when every list is clear', async () => {
    mocks.attention.mockResolvedValue({ data: attention({ items: [], count: 0, period: { ...attention().period!, waiting_count: 0, waiting_hours: 0 } }) })
    await open()
    expect(screen.getByText('Nothing needs you right now')).toBeInTheDocument()
    expect(screen.getByText('Approvals, clock-outs, leave and PINs are all clear.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Needs attention' })).toBeInTheDocument()
  })

  it('shows the pay period card the Cornerstone way when no period is published', async () => {
    mocks.attention.mockResolvedValue({ data: attention({ items: [], count: 0, period: { ...attention().period!, published: false } }) })
    mocks.getPayrollCutoff.mockResolvedValue({ data: cutoff(null) })
    await open()
    expect(screen.getByText('No pay period is published yet. Cornerstone Payroll publishes each period.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Payroll' })).toHaveAttribute('href', '/admin/payroll')
  })

  describe('when one block fails', () => {
    it('keeps the list and the hours when the lock time fails, and retries only the lock time', async () => {
      mocks.getPayrollCutoff.mockResolvedValue({ error: 'Something went wrong', status: 500 })
      await open()
      expect(screen.getByText(/Couldn't load the lock time\./)).toBeInTheDocument()
      expect(rowTexts()).toHaveLength(9)
      expect(screen.getByRole('img')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: /On the clock/ })).toBeInTheDocument()

      mocks.getPayrollCutoff.mockResolvedValue({ data: cutoff() })
      mocks.attention.mockClear()
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      await settle()
      expect(screen.queryByText(/Couldn't load the lock time\./)).not.toBeInTheDocument()
      expect(screen.getByText('Wed, Nov 18, 5:00 PM')).toBeInTheDocument()
      expect(mocks.attention).not.toHaveBeenCalled()
    })

    it('keeps the lock time and the clock when the list fails', async () => {
      mocks.attention.mockResolvedValue({ error: 'Something went wrong', status: 500 })
      await open()
      expect(screen.getByText("Couldn't load what needs attention.")).toBeInTheDocument()
      expect(screen.getByText(/Couldn't load the hours\./)).toBeInTheDocument()
      expect(screen.getByText('Wed, Nov 18, 5:00 PM')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: /On the clock\s+· 1/ })).toBeInTheDocument()
      expect(screen.queryByText('Nothing needs you right now')).not.toBeInTheDocument()
    })

    it('keeps the list when the clock fails', async () => {
      mocks.getWhosWorking.mockResolvedValue({ error: 'Something went wrong', status: 500 })
      await open()
      expect(screen.getByText("Couldn't load who is on the clock.")).toBeInTheDocument()
      expect(rowTexts()).toHaveLength(9)
    })

    it('keeps the last good answer on screen when a refresh fails', async () => {
      await open()
      mocks.attention.mockResolvedValue({ error: 'Something went wrong', status: 500 })
      await settle(60_000)
      expect(rowTexts()).toHaveLength(9)
      expect(screen.getByText(/Couldn't refresh the list/)).toHaveTextContent("Couldn't refresh the list. Last updated 7:41 PM.")
    })
  })

  describe('after a refresh fails', () => {
    it('does not claim everything is clear from an answer it could not refresh', async () => {
      mocks.attention.mockResolvedValueOnce({ data: attention({ items: [], count: 0 }) })
      await open()
      expect(screen.getByText('Nothing needs you right now')).toBeInTheDocument()
      mocks.attention.mockResolvedValue({ error: 'Something went wrong', status: 500 })
      await settle(60_000)
      expect(screen.queryByText('Nothing needs you right now')).not.toBeInTheDocument()
      expect(screen.getByText(/Couldn't refresh the list/)).toHaveTextContent('Last updated 7:41 PM.')
      expect(screen.getAllByRole('button', { name: 'Try again' }).length).toBeGreaterThan(0)
    })

    it('says the pay period hours are old, not current', async () => {
      await open()
      mocks.attention.mockResolvedValue({ error: 'Something went wrong', status: 500 })
      await settle(60_000)
      expect(screen.getByText(/Couldn't refresh the hours\. Last updated 7:41 PM\./)).toBeInTheDocument()
      expect(screen.getByRole('img')).toBeInTheDocument()
    })

    it('says the lock time and the connection are old when their refreshes fail', async () => {
      await open()
      mocks.getPayrollCutoff.mockResolvedValue({ error: 'Something went wrong', status: 500 })
      mocks.connection.mockResolvedValue({ error: 'Something went wrong', status: 500 })
      await settle(60_000)
      expect(screen.getByText(/Couldn't refresh the lock time\. Last updated 7:41 PM\./)).toBeInTheDocument()
      expect(screen.getByText(/Couldn't refresh the connection\. Last updated 7:41 PM\./)).toBeInTheDocument()
      expect(screen.getByText('Connected to Cornerstone Payroll')).toBeInTheDocument()
      // Recovers on the next good answer.
      mocks.getPayrollCutoff.mockResolvedValue({ data: cutoff() })
      mocks.connection.mockResolvedValue({ data: connection() })
      await settle(60_000)
      expect(screen.queryByText(/Couldn't refresh/)).not.toBeInTheDocument()
    })
  })

  describe('lock countdown', () => {
    it('counts down in days, with the absolute lock time', async () => {
      await open()
      expect(screen.getByText('Locks in 7 days')).toBeInTheDocument()
      expect(screen.getByText('Wed, Nov 18, 5:00 PM').tagName).toBe('TIME')
    })

    it('turns urgent under 24 hours', async () => {
      mocks.getPayrollCutoff.mockResolvedValue({ data: cutoff(lockControl({ cutoff_at: '2026-11-12T10:00:00+10:00' })) })
      await open()
      expect(screen.getByText('Locks in 14 hours').closest('[data-tone]')).toHaveAttribute('data-tone', 'needs-fix')
    })

    it('says the lock is on hold, not Locking now, when it is due while the connection is paused', async () => {
      mocks.attention.mockResolvedValue({ data: attention({ connected_payroll: { mode: 'paused', enabled: false, message: 'Paused' } }) })
      mocks.getPayrollCutoff.mockResolvedValue({ data: cutoff(lockControl({ cutoff_at: '2026-11-11T19:30:00+10:00', cutoff_state: 'due' })) })
      await open()
      expect(screen.getByText('Lock on hold: connection paused')).toBeInTheDocument()
      expect(screen.queryByText('Locking now')).not.toBeInTheDocument()
      expect(screen.getByText('Wed, Nov 11, 7:30 PM')).toBeInTheDocument()
    })

    it('says Locking now when the lock is due and the connection is up', async () => {
      mocks.getPayrollCutoff.mockResolvedValue({
        data: cutoff(lockControl({
          cutoff_at: '2026-11-11T19:40:00+10:00',
          cutoff_state: 'due',
          override: { action: 'lock_now', reason: 'Payroll run', set_at: NOW, set_by_name: 'Chels Cruz', set_by_system: 'aire_services', previous_cutoff_at: '2026-11-18T17:00:00+10:00' },
        })),
      })
      await open()
      expect(screen.getByText('Locking now')).toBeInTheDocument()
      expect(screen.queryByText(/^Locks in/)).not.toBeInTheDocument()
      expect(screen.getByText('Wed, Nov 11, 7:40 PM')).toBeInTheDocument()
    })

    it('uses the server clock when the device clock is wrong', async () => {
      // The device thinks it is a week later; the server says Nov 11.
      vi.setSystemTime(new Date('2026-11-18T00:00:00+10:00'))
      mocks.getPayrollCutoff.mockResolvedValue({ data: cutoff(lockControl(), NOW) })
      await open()
      expect(screen.getByText('Locks in 7 days')).toBeInTheDocument()
    })
  })

  describe('payroll connection', () => {
    const pausedItem = { key: 'payroll_problem:connection_paused', type: 'payroll_problem' as const, tone: 'needs_fix' as const, problem: 'connection_paused' as const, message: 'Paused' }

    it('puts a paused connection in a red banner and out of the list', async () => {
      const paused = { mode: 'paused' as const, enabled: false, message: 'Paused' }
      mocks.attention.mockResolvedValue({ data: attention({ items: [pausedItem, ...allItems.slice(2, 3)], connected_payroll: paused }) })
      mocks.connection.mockResolvedValue({ data: connection({ state: 'paused', enabled: false, mode: 'paused' }) })
      await open()
      const banner = screen.getByRole('alert')
      expect(banner).toHaveTextContent('Payroll connection paused. AIRE can\'t send locked hours to Cornerstone Payroll.')
      expect(within(banner).getByRole('link', { name: 'See details' })).toHaveAttribute('href', '/admin/settings/payroll-connection')
      // The banner comes before the pay period card, and the list has no paused row.
      expect(banner.compareDocumentPosition(screen.getByRole('heading', { name: 'Nov 1–15 pay period' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(rowTexts()).toEqual(['31 shifts waiting for approval'])
      expect(screen.getByRole('heading', { name: /Needs attention\s+· 1/ })).toBeInTheDocument()
    })

    it('shows no banner while the connection is fine', async () => {
      await open()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('shows the connection card on desktop', async () => {
      await open()
      const card = screen.getByRole('region', { name: 'Payroll connection' })
      expect(within(card).getByText('Connected to Cornerstone Payroll')).toBeInTheDocument()
      expect(within(card).getByText(/Last heard from 7:05 PM/)).toBeInTheDocument()
    })

    it('leaves the connection card, and its request, to desktop', async () => {
      restoreMatchMedia()
      restoreMatchMedia = mockMatchMedia({ width: 390 })
      await open()
      expect(screen.queryByRole('region', { name: 'Payroll connection' })).not.toBeInTheDocument()
      expect(mocks.connection).not.toHaveBeenCalled()
      expect(rowTexts()).toHaveLength(9)
    })
  })

  describe('refreshing', () => {
    const calls = () => mocks.attention.mock.calls.length

    it('loads once on open, then every 60 seconds while visible', async () => {
      await open()
      expect(calls()).toBe(1)
      await settle(59_000)
      expect(calls()).toBe(1)
      await settle(1_000)
      expect(calls()).toBe(2)
      expect(mocks.getPayrollCutoff).toHaveBeenCalledTimes(2)
      expect(mocks.getWhosWorking).toHaveBeenCalledTimes(2)
      expect(mocks.connection).toHaveBeenCalledTimes(2)
      await settle(60_000)
      expect(calls()).toBe(3)
    })

    it('does not poll a hidden tab, and refreshes when it comes back', async () => {
      await open()
      const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
      await settle(180_000)
      expect(calls()).toBe(1)
      visibility.mockReturnValue('visible')
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
      await settle()
      expect(calls()).toBe(2)
      visibility.mockRestore()
    })

    it('refreshes when the window gets focus, but not twice for one tab return', async () => {
      await open()
      await settle(10_000)
      await act(async () => { window.dispatchEvent(new Event('focus')) })
      await settle()
      expect(calls()).toBe(2)
      await act(async () => { window.dispatchEvent(new Event('focus')) })
      await settle()
      expect(calls()).toBe(2)
    })

    it('shows new work when a refresh brings it', async () => {
      mocks.attention.mockResolvedValueOnce({ data: attention({ items: allItems.slice(0, 1), count: 1 }) })
      await open()
      expect(rowTexts()).toHaveLength(1)
      await settle(60_000)
      expect(rowTexts()).toHaveLength(9)
    })
  })

  describe('Reset PIN', () => {
    it('resets the PIN and the row disappears', async () => {
      const pin = allItems.filter(item => item.type === 'kiosk_pin_locked')
      mocks.attention
        .mockResolvedValueOnce({ data: attention({ items: pin, count: 1 }) })
        .mockResolvedValue({ data: attention({ items: [], count: 0 }) })
      mocks.resetKioskPin.mockResolvedValue({ data: { kiosk_pin: '482913' } })
      await open()
      expect(rowTexts()).toEqual(['Kai Blas kiosk PIN locked'])
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reset PIN for Kai Blas' })) })
      expect(mocks.resetKioskPin).not.toHaveBeenCalled()
      await act(async () => { fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Reset PIN' })) })
      await settle()
      expect(mocks.resetKioskPin).toHaveBeenCalledWith(11, 3)
      expect(screen.getByRole('dialog', { name: 'New kiosk PIN for Kai Blas' })).toHaveTextContent('482913')
      expect(screen.queryByText('Kai Blas kiosk PIN locked')).not.toBeInTheDocument()
      expect(screen.getByText('Nothing needs you right now')).toBeInTheDocument()
    })
  })

  it('does not ask for payroll or clock data an admin without those rights cannot read', async () => {
    mocks.role = 'manager'
    await open()
    expect(mocks.getPayrollCutoff).not.toHaveBeenCalled()
    expect(mocks.connection).not.toHaveBeenCalled()
    expect(mocks.getWhosWorking).toHaveBeenCalled()
  })
})
