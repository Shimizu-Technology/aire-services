import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { PayrollPeriodSummary } from '../../lib/api/payrollPeriod'
import type { HandoffState } from '../../lib/payrollTerms'
import { carried } from '../../test/fixtures/payPeriod'
import { CarriedHours } from './CarriedHours'
import { HandoffSteps } from './HandoffSteps'

type StepPeriod = Pick<PayrollPeriodSummary, 'handoff_state' | 'status' | 'delivery' | 'payroll_status'>

function renderSteps(period: Partial<StepPeriod> & { handoff_state: HandoffState }) {
  render(<MemoryRouter><HandoffSteps period={{ status: 'finalized', delivery: null, payroll_status: null, ...period }} /></MemoryRouter>)
  return within(screen.getByRole('list', { name: 'Hand-off to Cornerstone Payroll' }))
}

const states = (list: ReturnType<typeof renderSteps>) => list.getAllByRole('listitem').map(item => item.getAttribute('data-state'))

describe('HandoffSteps', () => {
  it.each<[HandoffState, string, string[]]>([
    ['open', 'Open', ['now', 'next', 'next', 'next', 'next']],
    ['locked', 'Locked for payroll', ['done', 'now', 'next', 'next', 'next']],
    ['received', 'Received by Payroll', ['done', 'done', 'now', 'next', 'next']],
    ['in_run', 'In a payroll run', ['done', 'done', 'done', 'now', 'next']],
  ])('marks %s as the current step', (state, current, expected) => {
    const list = renderSteps({ handoff_state: state, status: state === 'open' ? 'scheduled' : 'finalized' })
    expect(list.getByText(current).closest('li')).toHaveAttribute('aria-current', 'step')
    expect(states(list)).toEqual(expected)
  })

  it('reads every step as done once paid', () => {
    const list = renderSteps({ handoff_state: 'paid', payroll_status: { status: 'payment_issued', occurred_at: null } })
    expect(states(list)).toEqual(['done', 'done', 'done', 'done', 'done'])
    expect(list.queryByText((_, element) => element?.getAttribute('aria-current') === 'step')).not.toBeInTheDocument()
  })

  it('names a payment problem in a payroll run', () => {
    renderSteps({ handoff_state: 'in_run', payroll_status: { status: 'payment_failed', occurred_at: null } })
    expect(screen.getByText('Payment problem')).toBeInTheDocument()
  })

  it('says when Payroll has not confirmed the locked hours', () => {
    renderSteps({ handoff_state: 'locked', delivery: { status: 'failed', stuck: false, attempts: 3, occurred_at: null, delivered_at: null, last_error: 'timeout' } })
    expect(screen.getByRole('status')).toHaveTextContent("Cornerstone Payroll hasn't confirmed it received the hours. AIRE keeps trying.")
  })

  it('has no steps for a period from before locking', () => {
    render(<MemoryRouter><HandoffSteps period={{ handoff_state: 'before_locking', status: 'finalized', delivery: null, payroll_status: null }} /></MemoryRouter>)
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.getByText(/Before locking. This period was paid before AIRE locked hours/)).toBeInTheDocument()
  })
})

describe('CarriedHours', () => {
  const range = { start: '2026-10-16', end: '2026-10-31' }

  it('renders nothing when no shift from this period was carried', () => {
    const { container } = render(<MemoryRouter><CarriedHours items={[carried({ original_work_date: '2026-11-03' })]} range={range} recordsHref="/admin/payroll/records" /></MemoryRouter>)
    expect(container).toBeEmptyDOMElement()
  })

  it('lists the carried shifts from this period', () => {
    render(<MemoryRouter><CarriedHours items={[carried()]} range={range} recordsHref="/admin/payroll/records" /></MemoryRouter>)
    expect(screen.getByRole('region', { name: /Hours carried to a later period/ })).toHaveTextContent('Jun Santos · Fri, Oct 30 · 8.9h→ Next payroll')
  })
})
