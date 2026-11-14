import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { connection } from '../../test/fixtures/today'
import { ConnectionCard, PausedBanner } from './ConnectionCard'

const NOW = new Date('2026-11-11T19:41:00+10:00')
const wrap = (node: React.ReactNode) => render(<MemoryRouter>{node}</MemoryRouter>)

describe('ConnectionCard', () => {
  it('says it is connected and when Payroll last answered', () => {
    wrap(<ConnectionCard connection={connection()} load="ready" now={NOW} onRetry={vi.fn()} />)
    expect(screen.getByText('Connected to Cornerstone Payroll')).toBeInTheDocument()
    expect(screen.getByText('Last heard from 7:05 PM · Oct 16–31 locked and received Nov 5')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Connection details' })).toHaveAttribute('href', '/admin/settings/payroll-connection')
  })

  it('gives the date when Payroll last answered on an earlier day', () => {
    wrap(<ConnectionCard connection={connection({ last_publication: { published_at: '2026-11-09T08:00:00+10:00', start_date: '2026-11-01', end_date: '2026-11-15' }, last_delivery: null })} load="ready" now={NOW} onRetry={vi.fn()} />)
    expect(screen.getByText('Last heard from Nov 9, 8:00 AM')).toBeInTheDocument()
  })

  it('says so when updates have not arrived', () => {
    wrap(<ConnectionCard connection={connection({ state: 'delivery_problem', undelivered: { count: 2, failed_count: 1, stuck_count: 1 } })} load="ready" now={NOW} onRetry={vi.fn()} />)
    expect(screen.getByText("2 updates for Payroll haven't arrived.")).toBeInTheDocument()
  })

  it('does not say connected when Payroll has not published, received or linked anything yet', () => {
    wrap(<ConnectionCard connection={connection({ last_publication: null, last_delivery: null, account_link: null })} load="ready" now={NOW} onRetry={vi.fn()} />)
    expect(screen.getByText('Not connected yet')).toBeInTheDocument()
    expect(screen.getByText('No word from Cornerstone Payroll yet')).toBeInTheDocument()
    expect(screen.queryByText('Connected to Cornerstone Payroll')).not.toBeInTheDocument()
  })

  it('still says connected once an account is linked, even before the first publication', () => {
    wrap(<ConnectionCard connection={connection({ last_publication: null, last_delivery: null })} load="ready" now={NOW} onRetry={vi.fn()} />)
    expect(screen.getByText('Connected to Cornerstone Payroll')).toBeInTheDocument()
  })

  it('shows the last answer with when it was updated if a refresh failed', () => {
    const onRetry = vi.fn()
    wrap(<ConnectionCard connection={connection()} load="stale" updatedAt={new Date('2026-11-11T19:30:00+10:00')} now={NOW} onRetry={onRetry} />)
    expect(screen.getByText('Connected to Cornerstone Payroll')).toBeInTheDocument()
    expect(screen.getByText(/Couldn't refresh the connection\. Last updated 7:30 PM\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('says it is paused', () => {
    wrap(<ConnectionCard connection={connection({ state: 'paused', enabled: false, mode: 'paused' })} load="ready" now={NOW} onRetry={vi.fn()} />)
    expect(screen.getByText('Payroll connection paused')).toBeInTheDocument()
    expect(screen.queryByText('Connected to Cornerstone Payroll')).not.toBeInTheDocument()
  })

  it('offers a retry when it cannot load', () => {
    const onRetry = vi.fn()
    wrap(<ConnectionCard connection={null} load="error" now={NOW} onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load the payroll connection.")
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalled()
  })
})

describe('PausedBanner', () => {
  it('leads with what stopped and what still works, and links to the details', () => {
    wrap(<PausedBanner />)
    const banner = screen.getByRole('alert')
    expect(banner).toHaveTextContent("Payroll connection paused. AIRE can't send locked hours to Cornerstone Payroll. Time tracking still works.")
    expect(screen.getByRole('link', { name: 'See details' })).toHaveAttribute('href', '/admin/settings/payroll-connection')
  })
})
