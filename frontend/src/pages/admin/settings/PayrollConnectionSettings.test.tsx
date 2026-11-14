import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { connection } from '../../../test/fixtures/today'
import { payrollConnectionCopy } from '../../../lib/payrollConnection'
import { settingsApi } from '../../../lib/api/settings'
import PayrollConnectionSettings from './PayrollConnectionSettings'

vi.mock('../../../lib/api/settings', () => ({ settingsApi: { connection: vi.fn() } }))
afterEach(() => vi.useRealTimers())
it.each(['paused', 'delivery_problem', 'connected'] as const)('uses the same %s headline as Today', async state => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-11T19:41:00+10:00'))
  const fixture = connection({ state, last_delivery: null, account_link: null })
  vi.mocked(settingsApi.connection).mockResolvedValue({ data: { ...fixture, account_link: null } })
  render(<MemoryRouter><PayrollConnectionSettings /></MemoryRouter>)
  expect(await screen.findByText(payrollConnectionCopy(fixture).title, { selector: '.font-semibold' })).toBeInTheDocument()
  expect(screen.getByText(payrollConnectionCopy(fixture).detail)).toBeInTheDocument()
})
