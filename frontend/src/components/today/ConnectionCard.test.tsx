import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { connection } from '../../test/fixtures/today'
import { ConnectionCard, PausedBanner } from './ConnectionCard'

const NOW = new Date('2026-11-11T19:41:00+10:00')
const wrap = (node: React.ReactNode) => render(<MemoryRouter>{node}</MemoryRouter>)

describe('ConnectionCard', () => {
  it('says Connected only after a recent confirmed receipt and shows its time', () => {
    wrap(<ConnectionCard connection={connection()} load="ready" now={NOW} onRetry={vi.fn()} />)
    expect(screen.getByText('Connected to Cornerstone Payroll')).toBeInTheDocument()
    expect(screen.getByText(/Last confirmed receipt: Nov 11, 2026, 7:00 PM/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Connection details' })).toHaveAttribute('href', '/admin/settings/payroll-connection')
  })
  it('does not claim Connected for a delivery problem even with a recent receipt', () => {
    wrap(<ConnectionCard connection={connection({ state: 'delivery_problem', undelivered: { count: 2, failed_count: 1, stuck_count: 1 } })} load="ready" now={NOW} onRetry={vi.fn()} />)
    expect(screen.getByText("Hours haven't reached Cornerstone Payroll yet")).toBeInTheDocument()
    expect(screen.getByText("2 updates for Payroll haven't arrived.")).toBeInTheDocument()
    expect(screen.queryByText('Connected to Cornerstone Payroll')).not.toBeInTheDocument()
  })
  it('does not treat an account link or a publication as a confirmed receipt', () => {
    wrap(<ConnectionCard connection={connection({ last_delivery: null })} load="ready" now={NOW} onRetry={vi.fn()} />)
    expect(screen.getByText('Set up, but nothing confirmed yet')).toBeInTheDocument()
    expect(screen.getByText(/No confirmed receipt/)).toBeInTheDocument()
    expect(screen.queryByText('Connected to Cornerstone Payroll')).not.toBeInTheDocument()
  })
  it('shows an old receipt without claiming a current connection', () => {
    wrap(<ConnectionCard connection={connection({ last_delivery: { delivered_at: '2026-11-05T09:00:00+10:00', occurred_at: '2026-11-05T08:59:00+10:00', period: null } })} load="ready" now={NOW} onRetry={vi.fn()} />)
    expect(screen.getByText('No recent receipt from Cornerstone Payroll')).toBeInTheDocument()
    expect(screen.getByText(/Last confirmed receipt: Nov 5, 2026, 9:00 AM/)).toBeInTheDocument()
  })
  it('retains the stale-data warning and offers a retry', () => {
    const retry = vi.fn()
    wrap(<ConnectionCard connection={connection()} load="stale" updatedAt={new Date('2026-11-11T19:30:00+10:00')} now={NOW} onRetry={retry} />)
    expect(screen.getByText(/Couldn't refresh the connection/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalled()
  })
  it('uses paused wording even after a confirmed receipt', () => {
    wrap(<ConnectionCard connection={connection({ state: 'paused' })} load="ready" now={NOW} onRetry={vi.fn()} />)
    expect(screen.getByText('Payroll connection paused')).toBeInTheDocument()
    expect(screen.queryByText('Connected to Cornerstone Payroll')).not.toBeInTheDocument()
  })
})

it('explains that tracking continues while delivery is paused', () => {
  wrap(<PausedBanner />)
  expect(screen.getByRole('alert')).toHaveTextContent("AIRE can't send locked hours to Cornerstone Payroll. Time tracking still works.")
})
