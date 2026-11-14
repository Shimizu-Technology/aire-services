import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { allItems } from '../../test/fixtures/today'
import { ToastProvider } from '../ui'
import { AttentionList } from './AttentionList'

const apiMock = vi.hoisted(() => ({ resetKioskPin: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: apiMock }))

function renderList(items = allItems, onChanged = vi.fn()) {
  render(<MemoryRouter><ToastProvider><AttentionList items={items} onChanged={onChanged} /></ToastProvider></MemoryRouter>)
  return { onChanged }
}

beforeEach(() => apiMock.resetKioskPin.mockReset())

describe('AttentionList', () => {
  it('lists the rows in the order the API sends them, one sentence each', () => {
    renderList()
    const rows = screen.getAllByRole('listitem').map(row => row.querySelector('p')?.textContent)
    expect(rows).toEqual([
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

  it('gives every row the facts it needs underneath', () => {
    renderList()
    const meta = screen.getAllByRole('listitem').map(row => row.querySelectorAll('p')[1]?.textContent)
    expect(meta).toEqual([
      'Since Tue, Nov 10, 7:02 AM · 36.7h',
      'Since 7:15 AM · Flight Instruction',
      '276.1h · 1 added by hand · oldest Fri, Nov 6',
      'Ethan Cruz · week of Nov 1',
      'Nov 1–15 · the lock needs a category on every shift',
      "AIRE couldn't lock these hours, so Payroll doesn't have them yet",
      'Next: Rosa Leon Guerrero, sick, Thu, Nov 12',
      'Too many wrong tries · unlocks 9:40 PM',
      'Oldest Tue, Nov 10',
    ])
  })

  it.each([
    ['Fix clock-out', '/admin/timecards?entry_id=812&date=2026-11-10&user_id=7'],
    ['Check', '/admin/timecards?entry_id=813&date=2026-11-11&user_id=8'],
    ['Fix', '/admin/timecards?entry_id=901'],
    ['See details', '/admin/payroll?start_date=2026-11-01&end_date=2026-11-15'],
    ['Open', '/admin/pay-stubs'],
  ])('%s opens %s', (name, href) => {
    renderList()
    expect(screen.getByRole('link', { name })).toHaveAttribute('href', href)
  })

  it('sends Review to the page that holds each kind of waiting work', () => {
    renderList()
    const reviews = screen.getAllByRole('link', { name: 'Review' }).map(link => link.getAttribute('href'))
    expect(reviews).toEqual(['/admin/approvals', '/admin/approvals?kind=overtime&user_id=9', '/admin/leave'])
  })

  it('leaves the person out of the overtime link when several people have overtime', () => {
    const overtime = allItems.find(item => item.type === 'overtime_waiting')!
    if (overtime.type !== 'overtime_waiting') throw new Error('fixture')
    renderList([{
      ...overtime, count: 3, hours: null, hours_complete: false, unprojected_count: 2,
      people: [
        { ...overtime.people[0], hours: 6 },
        { id: 12, full_name: 'Mia Santos', display_name: 'Mia', hours: null, entry_count: 2, week_starts: ['2026-11-01', '2026-11-08'] },
      ],
    }])
    expect(screen.getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/admin/approvals?kind=overtime')
    const row = screen.getByRole('listitem')
    expect(row.querySelector('p')).toHaveTextContent('Overtime on 3 shifts waiting')
    expect(row).toHaveTextContent('Ethan Cruz, Mia Santos · 2 weeks')
  })

  it('names what each payroll problem is and what to do', () => {
    renderList([
      { key: 'a', type: 'payroll_problem', tone: 'needs_fix', problem: 'lock_overdue', period: { start_date: '2026-11-01', end_date: '2026-11-15' } },
      {
        key: 'b', type: 'payroll_problem', tone: 'info', problem: 'lock_change_pending',
        change: { state: 'pending', action: 'lock_now', cutoff_at: null, requested_by_name: 'Chels Cruz', requested_at: '2026-11-11T19:30:00+10:00', error: null },
      },
      {
        key: 'c', type: 'payroll_problem', tone: 'needs_fix', problem: 'lock_change_refused',
        change: { state: 'rejected', action: 'change', cutoff_at: null, requested_by_name: null, requested_at: '2026-11-11T19:30:00+10:00', error: 'Too late' },
      },
    ])
    const rows = screen.getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('The lock is overdue for Nov 1–15')
    expect(rows[1]).toHaveTextContent('Lock now is waiting on Cornerstone Payroll')
    expect(rows[1]).toHaveTextContent('Asked by Chels Cruz')
    expect(rows[2]).toHaveTextContent('Cornerstone Payroll refused the lock time change')
    expect(rows[2]).toHaveTextContent('Too late')
    expect(screen.getAllByRole('link', { name: 'See details' }).map(link => link.getAttribute('href'))).toEqual([
      '/admin/payroll?start_date=2026-11-01&end_date=2026-11-15', '/admin/payroll', '/admin/payroll',
    ])
  })

  describe('Reset PIN', () => {
    const pinRow = () => screen.getByRole('listitem')
    const pinItem = allItems.filter(item => item.type === 'kiosk_pin_locked')

    it('resets in place, shows the new PIN once and asks the page to reload', async () => {
      apiMock.resetKioskPin.mockResolvedValue({ data: { kiosk_pin: '482913' } })
      const { onChanged } = renderList(pinItem)
      await act(async () => { fireEvent.click(within(pinRow()).getByRole('button', { name: 'Reset PIN for Kai Blas' })) })
      expect(apiMock.resetKioskPin).toHaveBeenCalledWith(11)
      expect(onChanged).toHaveBeenCalledTimes(1)
      const sheet = screen.getByRole('dialog', { name: 'New kiosk PIN for Kai Blas' })
      expect(sheet).toHaveTextContent('482913')
      fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('keeps the row and says why when the reset is refused', async () => {
      apiMock.resetKioskPin.mockResolvedValue({ error: 'Clock this person out before changing their kiosk access', status: 422 })
      const { onChanged } = renderList(pinItem)
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reset PIN for Kai Blas' })) })
      expect(screen.getByRole('status')).toHaveTextContent('Clock this person out before changing their kiosk access')
      expect(onChanged).not.toHaveBeenCalled()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Reset PIN for Kai Blas' })).toBeEnabled()
    })
  })
})
