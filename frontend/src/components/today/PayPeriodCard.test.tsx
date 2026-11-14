import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { lockControl, period as openPeriod } from '../../test/fixtures/today'
import { PayPeriodCard, type PayPeriodCardProps } from './PayPeriodCard'

const NOW = new Date('2026-11-11T19:41:00+10:00')

function renderCard(props: Partial<PayPeriodCardProps> = {}) {
  const onRetryPeriod = vi.fn()
  const onRetryLock = vi.fn()
  render(
    <MemoryRouter>
      <PayPeriodCard
        period={openPeriod}
        periodLoad="ready"
        lock={lockControl()}
        lockLoad="ready"
        now={NOW}
        onRetryPeriod={onRetryPeriod}
        onRetryLock={onRetryLock}
        {...props}
      />
    </MemoryRouter>,
  )
  return { onRetryPeriod, onRetryLock }
}

describe('PayPeriodCard', () => {
  it('shows the lock countdown with the absolute time next to it', () => {
    renderCard()
    expect(screen.getByRole('heading', { name: 'Nov 1–15 pay period' })).toBeInTheDocument()
    const pill = screen.getByText('Locks in 7 days').closest('[data-tone]')
    expect(pill).toHaveAttribute('data-tone', 'waiting')
    const time = screen.getByText('Wed, Nov 18, 5:00 PM')
    expect(time.tagName).toBe('TIME')
    expect(time).toHaveAttribute('datetime', '2026-11-18T17:00:00+10:00')
    expect(screen.getByText(/pays Wed, Nov 25/)).toBeInTheDocument()
  })

  it('describes approved and waiting hours as one image with both numbers', () => {
    renderCard()
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', '1,005h approved, 276.1h waiting (31 shifts)')
  })

  it('turns urgent inside 24 hours', () => {
    renderCard({ lock: lockControl({ cutoff_at: '2026-11-12T00:41:00+10:00' }) })
    const pill = screen.getByText('Locks in 5 hours').closest('[data-tone]')
    expect(pill).toHaveAttribute('data-tone', 'needs-fix')
    expect(screen.getByText('Thu, Nov 12, 12:41 AM')).toBeInTheDocument()
  })

  it('says "Locking now" once Lock now was asked for, and drops the old lock time', () => {
    renderCard({
      lock: lockControl({
        pending_change: { state: 'pending', action: 'lock_now', cutoff_at: null, requested_by_name: 'Chels Cruz', requested_at: '2026-11-11T19:40:00+10:00', error: null },
      }),
    })
    expect(screen.getByText('Locking now').closest('[data-tone]')).toHaveAttribute('data-tone', 'info')
    expect(screen.queryByText('Wed, Nov 18, 5:00 PM')).not.toBeInTheDocument()
    expect(screen.getByText(/AIRE is locking these hours/)).toBeInTheDocument()
  })

  it('says "Locking now" when the lock time has arrived', () => {
    renderCard({ lock: lockControl({ cutoff_at: '2026-11-11T19:41:00+10:00', cutoff_state: 'due' }) })
    expect(screen.getByText('Locking now')).toBeInTheDocument()
  })

  it('names a failed lock', () => {
    renderCard({ lock: lockControl({ status: 'failed', cutoff_state: 'attention_required' }) })
    expect(screen.getByText('Lock failed').closest('[data-tone]')).toHaveAttribute('data-tone', 'needs-fix')
  })

  it('shows a locked period by its stage and no countdown', () => {
    renderCard({ period: { ...openPeriod, handoff_state: 'received', label: 'Received by Payroll', waiting_count: 0, waiting_hours: 0 }, lock: null })
    expect(screen.getByText('Received by Payroll').closest('[data-tone]')).toHaveAttribute('data-tone', 'approved')
    expect(screen.queryByText(/^Locks /)).not.toBeInTheDocument()
  })

  it('keeps the hours when only the lock time fails, and retries just the lock time', () => {
    const { onRetryLock, onRetryPeriod } = renderCard({ lock: null, lockLoad: 'error' })
    expect(screen.getByText(/Couldn't load the lock time\./)).toBeInTheDocument()
    expect(screen.getByRole('img')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetryLock).toHaveBeenCalledTimes(1)
    expect(onRetryPeriod).not.toHaveBeenCalled()
  })

  it('keeps the lock time when only the hours fail', () => {
    const { onRetryPeriod } = renderCard({ period: null, periodLoad: 'error' })
    expect(screen.getByText('Wed, Nov 18, 5:00 PM')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Nov 1–15 pay period' })).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetryPeriod).toHaveBeenCalledTimes(1)
  })

  it('says when nothing is waiting', () => {
    renderCard({ period: { ...openPeriod, waiting_count: 0, waiting_hours: 0 } })
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', '1,005h approved, nothing waiting')
    expect(screen.getByText('Nothing waiting for approval')).toBeInTheDocument()
  })

  it('points to Payroll when no period is published', () => {
    renderCard({ period: { ...openPeriod, published: false }, lock: null })
    expect(screen.getByText('No pay period is published yet. Cornerstone Payroll publishes each period.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Payroll' })).toHaveAttribute('href', '/admin/payroll')
    expect(screen.queryByRole('link', { name: 'Review approvals' })).not.toBeInTheDocument()
  })

  it('links to the period’s approvals and its pay period page', () => {
    renderCard()
    expect(screen.getByRole('link', { name: 'Review approvals' })).toHaveAttribute('href', '/admin/approvals?period=2026-11-01')
    expect(screen.getByRole('link', { name: 'Open pay period' })).toHaveAttribute('href', '/admin/payroll?start_date=2026-11-01&end_date=2026-11-15')
  })
})
