import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { formatDateInTimeZoneISO } from '../../lib/dateUtils'
import ActivityHistory from './ActivityHistory'

const apiMock = vi.hoisted(() => ({
  getAuditLogs: vi.fn(),
  getAuditLog: vi.fn(),
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

function RouteHarness() {
  const navigate = useNavigate()
  return (
    <>
      <button type="button" onClick={() => navigate('/admin/activity?subject_type=TimeEntry&subject_id=44')}>Open entry history</button>
      <button type="button" onClick={() => navigate('/admin/activity?event_category=payroll&search=2026-08-16+through+2026-08-31')}>Open payroll history</button>
      <button onClick={() => navigate('/admin/activity?subject_type=User&subject_id=7&event_id=206')}>Open next exact event</button>
      <ActivityHistory />
    </>
  )
}

describe('ActivityHistory', () => {
  beforeEach(() => {
    apiMock.getAuditLog.mockReset()
    apiMock.getAuditLog.mockResolvedValue({ data: event })
    apiMock.getAuditLogs.mockReset()
    apiMock.downloadAuditLogs.mockReset()
    apiMock.getAuditLogs.mockResolvedValue({
      data: {
        audit_logs: [event],
        pagination: { page: 1, per_page: 50, total: 1, total_pages: 1 },
        filters: { event_categories: ['approvals', 'users', 'payroll'], sources: ['admin', 'kiosk'], outcomes: ['succeeded', 'denied'] },
      },
    })
  })

  it('loads the permanent event list and opens complete event context', async () => {
    renderPage()

    expect(await screen.findByText(event.summary)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(event.summary, 'i') }))

    expect(screen.getByText('Event details')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Activity event details' })).toHaveFocus()
    expect(screen.getByText('Verified with the employee')).toBeInTheDocument()
    expect(screen.getByText('request-91')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Activity event details' })).not.toBeInTheDocument()
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

  it('opens directly to linked payroll activity', async () => {
    renderPage('/admin/activity?event_category=payroll&search=2026-08-16+through+2026-08-31')

    await screen.findByText(event.summary)
    expect(apiMock.getAuditLogs).toHaveBeenCalledWith(expect.objectContaining({
      event_category: 'payroll',
      search: '2026-08-16 through 2026-08-31',
    }))
    expect(screen.getByPlaceholderText('Search people, records, or actions')).toHaveValue('2026-08-16 through 2026-08-31')
  })

  it('refreshes record scope when the route search parameters change', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/activity']}>
        <RouteHarness />
      </MemoryRouter>,
    )
    await screen.findByText(event.summary)

    fireEvent.click(screen.getByRole('button', { name: 'Open entry history' }))

    await waitFor(() => expect(apiMock.getAuditLogs).toHaveBeenCalledWith(expect.objectContaining({
      subject_type: 'TimeEntry',
      subject_id: 44,
    })))
  })

  it('synchronizes list filters when same-route query parameters change', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/activity']}>
        <RouteHarness />
      </MemoryRouter>,
    )
    await screen.findByText(event.summary)

    fireEvent.click(screen.getByRole('button', { name: 'Open payroll history' }))

    await waitFor(() => expect(apiMock.getAuditLogs).toHaveBeenCalledWith(expect.objectContaining({
      event_category: 'payroll',
      search: '2026-08-16 through 2026-08-31',
    })))
    expect(screen.getByLabelText('Event category')).toHaveValue('payroll')
    expect(screen.getByPlaceholderText('Search people, records, or actions')).toHaveValue('2026-08-16 through 2026-08-31')
  })

  it.each([
    '/admin/activity?subject_type=TimeEntry',
    '/admin/activity?subject_id=44',
    '/admin/activity?subject_type=TimeEntry&subject_id=invalid',
  ])('ignores incomplete record scope in %s', async (initialEntry) => {
    renderPage(initialEntry)
    await screen.findByText(event.summary)

    for (const [filters] of apiMock.getAuditLogs.mock.calls) {
      expect(filters).not.toHaveProperty('subject_type')
      expect(filters).not.toHaveProperty('subject_id')
    }
    expect(screen.queryByText(/Showing history for/)).not.toBeInTheDocument()
  })

  it('adds a bounded default date window to CSV exports', async () => {
    apiMock.downloadAuditLogs.mockResolvedValue({ error: 'test download stopped' })
    renderPage()
    await screen.findByText(event.summary)

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))

    await waitFor(() => expect(apiMock.downloadAuditLogs).toHaveBeenCalledWith(expect.objectContaining({
      from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    })))
  })

  it('uses the current Guam calendar date for the default export boundary', () => {
    expect(formatDateInTimeZoneISO(new Date('2026-08-30T14:30:00Z'), 'Pacific/Guam')).toBe('2026-08-31')
  })

 it('loads the exact linked event beyond the list page and preserves the employee return', async () => {
   const linked = { ...event, id: 205, summary: 'Older employee profile event', subject: { type: 'User', id: 7, name: 'Alice' } }
   apiMock.getAuditLog.mockResolvedValue({ data: linked })
   renderPage('/admin/activity?subject_type=User&subject_id=7&event_id=205&return_to=%2Fadmin%2Fusers%2F7%3Ftab%3Dactivity')
   expect(await screen.findByText(linked.summary)).toBeInTheDocument()
   expect(apiMock.getAuditLog).toHaveBeenCalledWith(205)
   expect(screen.getByRole('link', { name: 'Back to employee' })).toHaveAttribute('href', '/admin/users/7?tab=activity')
   await waitFor(() => expect(apiMock.getAuditLogs).toHaveBeenCalled())
   expect(screen.getByText('Event details')).toBeInTheDocument()
 })

 it('refuses a linked event with the wrong employee subject', async () => {
   apiMock.getAuditLog.mockResolvedValue({ data: { ...event, id: 205, subject: { type: 'User', id: 8, name: 'Other person' } } })
   renderPage('/admin/activity?subject_type=User&subject_id=7&event_id=205')
   expect(await screen.findByText('The linked event does not match this record.')).toBeInTheDocument()
   expect(screen.queryByText('Event details')).not.toBeInTheDocument()
 })

 it('discards an earlier exact event response after another event is opened', async () => {
   let resolveFirst: (value: { data: typeof event }) => void = () => undefined
   apiMock.getAuditLog.mockImplementation((id: number) => id === 205 ? new Promise((resolve) => { resolveFirst = resolve }) : Promise.resolve({ data: { ...event, id: 206, summary: 'Next event evidence', subject: { type: 'User', id: 7, name: 'Alice' } } }))
   render(<MemoryRouter initialEntries={['/admin/activity?subject_type=User&subject_id=7&event_id=205']}><RouteHarness /></MemoryRouter>)
   await waitFor(() => expect(apiMock.getAuditLog).toHaveBeenCalledWith(205))
   fireEvent.click(screen.getByRole('button', { name: 'Open next exact event' }))
   expect(await screen.findByText('Next event evidence')).toBeInTheDocument()
   resolveFirst({ data: { ...event, id: 205, summary: 'Stale event evidence', subject: { type: 'User', id: 7, name: 'Alice' } } })
   await waitFor(() => expect(screen.queryByText('Stale event evidence')).not.toBeInTheDocument())
 })

})
