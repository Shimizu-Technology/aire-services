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
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', '1,005h Approved for payroll, 276.1h Time waiting for approval, 0h Overtime waiting for approval')
  })

  it('turns urgent inside 24 hours', () => {
    renderCard({ lock: lockControl({ cutoff_at: '2026-11-12T00:41:00+10:00' }) })
    const pill = screen.getByText('Locks in 5 hours').closest('[data-tone]')
    expect(pill).toHaveAttribute('data-tone', 'needs-fix')
    expect(screen.getByText('Thu, Nov 12, 12:41 AM')).toBeInTheDocument()
  })

  it('says a Lock now is requested while Payroll has not confirmed it, and keeps the scheduled time', () => {
    renderCard({
      lock: lockControl({
        pending_change: { state: 'pending', action: 'lock_now', cutoff_at: null, requested_by_name: 'Chels Cruz', requested_at: '2026-11-11T19:40:00+10:00', error: null },
      }),
    })
    expect(screen.getByText('Lock requested · waiting for Cornerstone Payroll').closest('[data-tone]')).toHaveAttribute('data-tone', 'info')
    expect(screen.queryByText('Locking now')).not.toBeInTheDocument()
    const time = screen.getByText('Wed, Nov 18, 5:00 PM')
    expect(time.tagName).toBe('TIME')
    expect(screen.getByText(/^Scheduled lock/)).toBeInTheDocument()
  })

  it('says "Locking now" when the lock time has arrived', () => {
    renderCard({ lock: lockControl({ cutoff_at: '2026-11-11T19:41:00+10:00', cutoff_state: 'due' }) })
    expect(screen.getByText('Locking now')).toBeInTheDocument()
    expect(screen.getByText('Wed, Nov 11, 7:41 PM')).toBeInTheDocument()
  })

  it('keeps counting down in the last minute', () => {
    renderCard({ lock: lockControl({ cutoff_at: '2026-11-11T19:41:45+10:00' }) })
    expect(screen.getByText('Locks in under a minute')).toBeInTheDocument()
    expect(screen.queryByText('Locking now')).not.toBeInTheDocument()
  })

  it('does not say Locking now while the connection is paused, because nothing will lock', () => {
    renderCard({ lock: lockControl({ cutoff_at: '2026-11-11T19:30:00+10:00', cutoff_state: 'due' }), paused: true })
    const pill = screen.getByText('Lock on hold: connection paused').closest('[data-tone]')
    expect(pill).toHaveAttribute('data-tone', 'needs-fix')
    expect(screen.queryByText('Locking now')).not.toBeInTheDocument()
    expect(screen.getByText('Wed, Nov 11, 7:30 PM')).toBeInTheDocument()
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
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', '1,005h Approved for payroll, 0h Time waiting for approval, 0h Overtime waiting for approval')
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

  describe('when the hours and the lock are for different pay periods', () => {
    const otherLock = () => lockControl({
      period: { id: 6, external_pay_period_id: 'ext-6', start_date: '2026-10-16', end_date: '2026-10-31', pay_date: '2026-11-10' },
      cutoff_at: '2026-11-03T17:00:00+10:00',
      status: 'failed',
    })

    it('never pairs one period\'s hours with another period\'s lock', () => {
      renderCard({ lock: otherLock() })
      expect(screen.getByRole('heading', { name: 'Nov 1–15 pay period' })).toBeInTheDocument()
      expect(screen.queryByText('Lock failed')).not.toBeInTheDocument()
      expect(screen.queryByText(/Tue, Nov 10/)).not.toBeInTheDocument()
      // The period's own lock time and pay date stand in.
      expect(screen.getByText('Wed, Nov 18, 5:00 PM')).toBeInTheDocument()
      expect(screen.getByText(/pays Wed, Nov 25/)).toBeInTheDocument()
      expect(screen.getByText('Lock details are for another pay period and are updating.')).toBeInTheDocument()
    })
  })

  describe('when a refresh failed', () => {
    it('keeps the last lock time and hours and says when they were last updated', () => {
      const { onRetryLock, onRetryPeriod } = renderCard({
        periodLoad: 'stale',
        periodUpdatedAt: new Date('2026-11-11T19:30:00+10:00'),
        lockLoad: 'stale',
        lockUpdatedAt: new Date('2026-11-11T19:31:00+10:00'),
      })
      expect(screen.getByRole('img')).toBeInTheDocument()
      expect(screen.getByText('Wed, Nov 18, 5:00 PM')).toBeInTheDocument()
      expect(screen.getByText(/Couldn't refresh the lock time\. Last updated 7:31 PM\./)).toBeInTheDocument()
      expect(screen.getByText(/Couldn't refresh the hours\. Last updated 7:30 PM\./)).toBeInTheDocument()
      const retries = screen.getAllByRole('button', { name: 'Try again' })
      fireEvent.click(retries[0])
      fireEvent.click(retries[1])
      expect(onRetryLock).toHaveBeenCalledTimes(1)
      expect(onRetryPeriod).toHaveBeenCalledTimes(1)
    })
  })
})
