import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, it } from 'vitest'
import { carried } from '../../test/fixtures/payPeriod'
import { CarriedHours } from './CarriedHours'
it('shows a zero-hour open clock as still clocked in, then shows hours once it is closed', () => {
  const item = carried({ exclusion_reason: 'open_clock', current_total_hours: 0, still_clocked_in: true })
  const view = (open: boolean) => <MemoryRouter><CarriedHours items={[{ ...item, still_clocked_in: open, current_total_hours: open ? 0 : 8 }]} range={{ start: '2026-10-16', end: '2026-10-31' }} recordsHref="/admin/payroll/records" /></MemoryRouter>
  const { rerender } = render(view(true))
  expect(screen.getByText(/Still clocked in/)).toBeInTheDocument()
  expect(screen.queryByText(/0.0h/)).not.toBeInTheDocument()
  expect(screen.getByText('Needs a clock-out')).toBeInTheDocument()
  rerender(view(false))
  expect(screen.queryByText(/Still clocked in/)).not.toBeInTheDocument()
  expect(screen.getByText(/8.0h/)).toBeInTheDocument()
})
