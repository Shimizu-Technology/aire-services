import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PayrollAccountLink from './PayrollAccountLink'

const apiMock = vi.hoisted(() => ({
  getPayrollAccountLinkSession: vi.fn(),
  authorizePayrollAccountLink: vi.fn(),
}))

vi.mock('../../lib/api', () => ({ api: apiMock }))

const session = {
  external_actor_email: 'chels@cornerstone.gu',
  expires_at: '2026-09-15T08:10:00Z',
  return_url: 'https://payroll.example.com/time-tracking-sources?source_id=3',
  aire_user: {
    name: 'Chels Admin',
    email: 'chels@aire.gu',
  },
}

function renderPage(path = '/admin/payroll-link?token=aire_link_test') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PayrollAccountLink />
    </MemoryRouter>,
  )
}

function SwitchablePage() {
  const navigate = useNavigate()
  return (
    <>
      <button type="button" onClick={() => navigate('/admin/payroll-link?token=aire_link_second')}>
        Open another request
      </button>
      <PayrollAccountLink />
    </>
  )
}

describe('PayrollAccountLink', () => {
  beforeEach(() => {
    apiMock.getPayrollAccountLinkSession.mockReset()
    apiMock.authorizePayrollAccountLink.mockReset()
    apiMock.getPayrollAccountLinkSession.mockResolvedValue({
      data: { account_link_session: session },
    })
  })

  it('explains the one-time connection and the accounts being linked', async () => {
    renderPage()

    expect(await screen.findByText('Chels Admin')).toBeInTheDocument()
    expect(screen.getByText('chels@cornerstone.gu')).toBeInTheDocument()
    expect(screen.getByText('chels@aire.gu')).toBeInTheDocument()
    expect(screen.getByText(/does not expire on a timer/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute(
      'href',
      'https://payroll.example.com/time-tracking-sources?source_id=3&aire_link=cancelled',
    )
  })

  it('shows an actionable error when the request is missing', async () => {
    renderPage('/admin/payroll-link')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Return to Cornerstone and start again',
    )
    expect(apiMock.getPayrollAccountLinkSession).not.toHaveBeenCalled()
  })

  it('keeps the consent screen available when authorization fails', async () => {
    apiMock.authorizePayrollAccountLink.mockResolvedValue({
      error: 'This connection request has expired',
    })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /Connect and return/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('expired')
    })
    expect(screen.getByRole('button', { name: /Connect and return/i })).toBeEnabled()
  })

  it('never displays or authorizes consent details loaded for a previous token', async () => {
    let resolveSecond!: (value: {
      data: { account_link_session: typeof session }
    }) => void
    const secondResponse = new Promise<{ data: { account_link_session: typeof session } }>((resolve) => {
      resolveSecond = resolve
    })
    apiMock.getPayrollAccountLinkSession
      .mockResolvedValueOnce({ data: { account_link_session: session } })
      .mockReturnValueOnce(secondResponse)

    render(
      <MemoryRouter initialEntries={['/admin/payroll-link?token=aire_link_first']}>
        <SwitchablePage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Chels Admin')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open another request' }))

    expect(screen.queryByText('Chels Admin')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Connect and return/i })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Checking this connection request')

    resolveSecond({
      data: {
        account_link_session: {
          ...session,
          external_actor_email: 'dafne@cornerstone.gu',
          aire_user: { name: 'Dafne Admin', email: 'dafne@aire.gu' },
        },
      },
    })

    expect(await screen.findByText('Dafne Admin')).toBeInTheDocument()
    expect(screen.queryByText('Chels Admin')).not.toBeInTheDocument()
  })
})

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.resetModules() })
it.each(['https://payroll.example.com/return?source_id=3', 'https://PAYROLL-STAGING.example.test/return?source_id=3'])('rejects copied or mixed-case staging consent return URLs %s', async returnUrl => {
  vi.stubEnv('VITE_DEPLOYMENT_ENV', 'staging')
  vi.stubEnv('VITE_STAGING_PAYROLL_FRONTEND_ORIGIN', 'https://payroll-staging.example.test')
  const { default: StagingLink } = await import('./PayrollAccountLink')
  apiMock.getPayrollAccountLinkSession.mockResolvedValue({ data: { account_link_session: { ...session, return_url: returnUrl } } })
  render(<MemoryRouter initialEntries={['/admin/payroll-link?token=synthetic']}><StagingLink /></MemoryRouter>)
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid staging connection destination')
  expect(screen.queryByRole('link', { name: 'Cancel' })).toBeNull()
  expect(screen.queryByRole('button', { name: /Connect and return/i })).toBeNull()
})
it('rejects a production authorization response while retaining the valid staging consent screen', async () => {
  vi.stubEnv('VITE_DEPLOYMENT_ENV', 'staging')
  vi.stubEnv('VITE_STAGING_PAYROLL_FRONTEND_ORIGIN', 'https://payroll-staging.example.test')
  const { default: StagingLink } = await import('./PayrollAccountLink')
  apiMock.getPayrollAccountLinkSession.mockResolvedValue({ data: { account_link_session: { ...session, return_url: 'https://payroll-staging.example.test/return?source_id=3' } } })
  apiMock.authorizePayrollAccountLink.mockResolvedValue({ data: { redirect_url: 'https://payroll.example.com/return?token=synthetic' } })
  render(<MemoryRouter initialEntries={['/admin/payroll-link?token=synthetic']}><StagingLink /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: /Connect and return/i }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid staging connection destination')
  expect(screen.getByRole('button', { name: /Connect and return/i })).toBeEnabled()
  expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', 'https://payroll-staging.example.test/return?source_id=3&aire_link=cancelled')
})
