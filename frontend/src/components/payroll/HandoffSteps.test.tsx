import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { PayrollPeriodSummary } from '../../lib/api/payrollPeriod'
import type { HandoffState } from '../../lib/payrollTerms'
import { carried, preview } from '../../test/fixtures/payPeriod'
import { CarriedHours } from './CarriedHours'
import { HandoffSteps } from './HandoffSteps'
import { BeforeLockChecklist, type ChecklistSource } from './BeforeLockChecklist'
import { WhatGoesToPayroll } from './WhatGoesToPayroll'
import { mockMatchMedia } from '../../test/matchMedia'

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
    const { unmount } = render(<MemoryRouter><HandoffSteps period={{ handoff_state: 'before_locking', status: 'scheduled', delivery: null, payroll_status: null }} /></MemoryRouter>)
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    // Codex finding 1: no payment claim without payment evidence.
    expect(screen.getByText("Before locking. AIRE didn't lock hours for this period.")).toBeInTheDocument()
    expect(screen.queryByText(/paid/i)).not.toBeInTheDocument()
    unmount()
    render(<MemoryRouter><HandoffSteps period={{ handoff_state: 'before_locking', status: 'finalized', delivery: null, payroll_status: null }} /></MemoryRouter>)
    expect(screen.getByText("Before locking. AIRE didn't lock hours for this period; its hours were recorded here.")).toBeInTheDocument()
  })
})

describe('CarriedHours', () => {
  const range = { start: '2026-10-16', end: '2026-10-31' }

  it('renders nothing when no shift from this period was carried', () => {
    const { container } = render(<MemoryRouter><CarriedHours items={[carried({ original_work_date: '2026-11-03' })]} range={range} recordsHref="/admin/payroll/records" /></MemoryRouter>)
    expect(container).toBeEmptyDOMElement()
  })

  // Codex finding 7: the carried part, not the whole shift.
  it('shows the carried part of a shift and the whole shift beside it', () => {
    render(<MemoryRouter><CarriedHours items={[carried({ exclusion_reason: 'overtime_approved_after_cutoff', held_total_hours: 2, current_total_hours: 10 })]} range={range} recordsHref="/admin/payroll/records" /></MemoryRouter>)
    expect(screen.getByRole('region', { name: /Hours carried to a later period/ })).toHaveTextContent('Jun Santos · Fri, Oct 30 · 2h of a 10h shift→ Next payroll')
  })

  it('lists the carried shifts from this period', () => {
    render(<MemoryRouter><CarriedHours items={[carried()]} range={range} recordsHref="/admin/payroll/records" /></MemoryRouter>)
    expect(screen.getByRole('region', { name: /Hours carried to a later period/ })).toHaveTextContent('Jun Santos · Fri, Oct 30 · 8.9h→ Next payroll')
  })
})

// Codex finding 4: a failed refresh never leaves an unqualified "all clear".
describe('stale answers', () => {
  const range = { start: '2026-11-01', end: '2026-11-15' }
  const clear = { range, today: '2026-11-11', attention: null, preview: preview({ employees: [], exclusions: [] }), previousStart: null,
    waiting: { count: 0, hours: 0, overtime: { count: 0, hours: 0, people: [] } } }
  const loadedAt = new Date('2026-11-11T19:41:00+10:00')
  const renderChecklist = (sources: ChecklistSource[]) => render(<MemoryRouter><BeforeLockChecklist {...clear} sources={sources} onRetry={vi.fn()} /></MemoryRouter>)

  it('says all clear only when every source just loaded', () => {
    renderChecklist([{ load: 'ready', loadedAt }, { load: 'ready', loadedAt }])
    expect(screen.getByRole('heading', { name: 'Before it locks · all clear' })).toBeInTheDocument()
  })

  it('qualifies the lines when a refresh failed', () => {
    renderChecklist([{ load: 'stale', loadedAt }, { load: 'ready', loadedAt }])
    expect(screen.getByRole('heading', { name: 'Before it locks' })).toBeInTheDocument()
    expect(screen.queryByText(/all clear/)).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't refresh the checklist · Last updated 7:41 PM. It may not be ready to lock. Try again")
  })

  it('says lines are missing when a source never loaded', () => {
    renderChecklist([{ load: 'error', loadedAt: null }, { load: 'ready', loadedAt }])
    expect(screen.queryByText(/all clear/)).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't refresh the checklist · Some lines couldn't load.")
  })

  it('marks a stale preview table with when it last loaded', () => {
    const restore = mockMatchMedia({ width: 1280 })
    render(<MemoryRouter><WhatGoesToPayroll payload={preview()} locked={false} returnTo="/admin/payroll" exporting={null} onExport={vi.fn()} staleSince={loadedAt} onRetry={vi.fn()} /></MemoryRouter>)
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't refresh what goes to payroll. Last updated 7:41 PM.")
    restore()
  })
})
