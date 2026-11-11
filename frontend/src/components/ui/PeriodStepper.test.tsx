import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import type { PayPeriod } from '../../lib/payPeriods'
import { PeriodStepper } from './PeriodStepper'

const NOW = new Date('2026-11-11T00:00:00Z')

function Stepper({ start, min, max, now = NOW }: { start: PayPeriod; min?: string; max?: string; now?: Date }) {
  const [period, setPeriod] = useState(start)
  return (
    <>
      <PeriodStepper period={period} onChange={setPeriod} min={min} max={max} now={now} />
      <output>{`${period.start}..${period.end}`}</output>
    </>
  )
}

const shown = () => screen.getByRole('status', { hidden: true })

describe('PeriodStepper', () => {
  it('labels the buttons and says which period this is', () => {
    render(<Stepper start={{ start: '2026-11-01', end: '2026-11-15' }} />)
    expect(screen.getByRole('button', { name: 'Previous pay period' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next pay period' })).toBeInTheDocument()
    expect(screen.getByText('Nov 1–15').parentElement).toHaveTextContent('Nov 1–15 · this pay period')
    expect(screen.getByText('Nov 1–15').parentElement).toHaveAttribute('aria-live', 'polite')
  })

  it('steps across month ends and the new year', async () => {
    const user = userEvent.setup()
    render(<Stepper start={{ start: '2026-11-16', end: '2026-11-30' }} />)
    await user.click(screen.getByRole('button', { name: 'Next pay period' }))
    expect(screen.getByRole('status')).toHaveTextContent('2026-12-01..2026-12-15')
    await user.click(screen.getByRole('button', { name: 'Next pay period' }))
    await user.click(screen.getByRole('button', { name: 'Next pay period' }))
    expect(screen.getByRole('status')).toHaveTextContent('2027-01-01..2027-01-15')
    expect(screen.getByText('Jan 1–15, 2027')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Previous pay period' }))
    expect(screen.getByRole('status')).toHaveTextContent('2026-12-16..2026-12-31')
  })

  it('ends February on the 28th, and the 29th in a leap year', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Stepper start={{ start: '2027-02-01', end: '2027-02-15' }} now={new Date('2027-02-10T00:00:00Z')} />)
    await user.click(screen.getByRole('button', { name: 'Next pay period' }))
    expect(screen.getByRole('status')).toHaveTextContent('2027-02-16..2027-02-28')
    expect(screen.getByText('Feb 16–28')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next pay period' }))
    expect(screen.getByRole('status')).toHaveTextContent('2027-03-01..2027-03-15')
    unmount()

    render(<Stepper start={{ start: '2028-03-01', end: '2028-03-15' }} now={new Date('2028-03-05T00:00:00Z')} />)
    await user.click(screen.getByRole('button', { name: 'Previous pay period' }))
    expect(screen.getByRole('status')).toHaveTextContent('2028-02-16..2028-02-29')
    expect(screen.getByText('Feb 16–29')).toBeInTheDocument()
    expect(screen.getByText('Feb 16–29').parentElement).toHaveTextContent('last pay period')
  })

  it('stops at min and max', async () => {
    const user = userEvent.setup()
    render(<Stepper start={{ start: '2026-11-01', end: '2026-11-15' }} min="2026-10-16" max="2026-11-01" />)
    expect(screen.getByRole('button', { name: 'Next pay period' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Previous pay period' }))
    expect(screen.getByRole('button', { name: 'Previous pay period' })).toBeDisabled()
    expect(shown()).toHaveTextContent('2026-10-16..2026-10-31')
  })

  it('reaches the period someone was hired in, mid-period', async () => {
    const user = userEvent.setup()
    render(<Stepper start={{ start: '2026-11-01', end: '2026-11-15' }} min="2026-10-20" />)
    const previous = screen.getByRole('button', { name: 'Previous pay period' })
    expect(previous).toBeEnabled()
    await user.click(previous)
    expect(shown()).toHaveTextContent('2026-10-16..2026-10-31')
    expect(previous).toBeDisabled()
  })
})
