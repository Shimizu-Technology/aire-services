import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
})
