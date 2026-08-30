import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ActivityHistory from './ActivityHistory'

const apiMock = vi.hoisted(() => ({
  getAuditLogs: vi.fn(),
  downloadAuditLogs: vi.fn(),
}))

vi.mock('../../lib/api', () => ({ api: apiMock }))

const event = {
  id: 91,
  action: 'time_entry.approved',
  event_category: 'approvals',
  occurred_at: '2026-08-30T12:00:00Z',
  outcome: 'succeeded',
  source: 'admin',
  summary: 'Ada Manager approved 8 hours on August 30',
  actor: { id: 1, name: 'Ada Manager', email: 'ada@example.com', role: 'admin', kind: 'user' },
  subject: { type: 'TimeEntry', id: 44, name: '8 hours on August 30' },
  changes: {},
  details: { review_note: 'Verified with the employee' },
  request: { id: 'request-91', ip_address: '192.0.2.10', user_agent: null, correlation_id: null },
}

function renderPage(initialEntry = '/admin/activity') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ActivityHistory />
    </MemoryRouter>,
  )
}

describe('ActivityHistory', () => {
  beforeEach(() => {
    apiMock.getAuditLogs.mockReset()
    apiMock.downloadAuditLogs.mockReset()
    apiMock.getAuditLogs.mockResolvedValue({
      data: {
        audit_logs: [event],
        pagination: { page: 1, per_page: 50, total: 1, total_pages: 1 },
        filters: { event_categories: ['approvals', 'users'], sources: ['admin', 'kiosk'], outcomes: ['succeeded', 'denied'] },
      },
    })
  })

  it('loads the permanent event list and opens complete event context', async () => {
    renderPage()

    expect(await screen.findByText(event.summary)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(event.summary, 'i') }))

    expect(screen.getByText('Event details')).toBeInTheDocument()
    expect(screen.getByText('Verified with the employee')).toBeInTheDocument()
    expect(screen.getByText('request-91')).toBeInTheDocument()
  })

  it('applies category and search filters through the API', async () => {
    renderPage()
    await screen.findByText(event.summary)

    fireEvent.change(screen.getByLabelText('Event category'), { target: { value: 'users' } })
    fireEvent.change(screen.getByPlaceholderText('Search people, records, or actions'), { target: { value: 'Jordan' } })

    await waitFor(() => expect(apiMock.getAuditLogs).toHaveBeenCalledWith(expect.objectContaining({
      event_category: 'users',
      search: 'Jordan',
      page: 1,
    })))
  })
})
