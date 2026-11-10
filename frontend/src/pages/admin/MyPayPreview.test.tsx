import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MyPayPreview from './MyPayPreview'
import { MyPayError, type MyPayPreviewWorker, type MyPayStatementDetail, type MyPayStatementSummary } from '../../lib/myPayApi'

const preview = vi.hoisted(() => ({
  workers: vi.fn(),
  worker: vi.fn(),
  source: vi.fn(),
  list: vi.fn(),
  statement: vi.fn(),
  pdf: vi.fn(),
}))
const own = vi.hoisted(() => ({ list: vi.fn(), statement: vi.fn(), pdf: vi.fn() }))
const auth = vi.hoisted(() => ({ value: { isClerkEnabled: true, currentUser: { id: 1, role: 'admin', my_pay_enabled: false, my_pay_preview_enabled: true } as Record<string, unknown> | null } }))

vi.mock('../../lib/myPayApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/myPayApi')>()
  return {
    ...actual,
    myPayApi: own,
    myPayPreviewApi: { workers: preview.workers, worker: preview.worker, source: preview.source },
  }
})
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => auth.value }))

const workers: MyPayPreviewWorker[] = [
  { id: 12, name: 'Ana Worker', role: 'employee', sent_to_payroll: true },
  { id: 13, name: 'José Pilot', role: 'employee', sent_to_payroll: true },
  { id: 2, name: 'Chels Admin', role: 'admin', sent_to_payroll: false },
]

function summary(overrides: Partial<MyPayStatementSummary> = {}): MyPayStatementSummary {
  return {
    id: '42', pay_date: '2026-11-15', check_date: '2026-11-15', period_start: '2026-10-16', period_end: '2026-10-31',
    run_purpose: 'regular', gross_pay: '1480.00', net_pay: '1480.00', total_hours: '80.00',
    payment: { method: 'paper_check', status: 'issued', issued_on: '2026-11-15', check_number_last4: '4321' },
    has_source_entries: true,
    ...overrides,
  }
}

function detail(): MyPayStatementDetail {
  return {
    ...summary(),
    earnings: [{ label: 'Contract Labor', hours: '80.00', rate: '18.50', amount: '1480.00', ytd: '23490.00', kind: 'regular' }],
    taxes: [],
    deductions: [],
    other_pay: [],
    ytd: { gross: '23490.00', net: '23490.00' },
    hours_on_check: [
      { time_entry_id: 501, work_date: '2026-10-20', category: 'Flight instruction', total_hours: '8.00', source_kind: 'current', prior_period: false },
    ],
  }
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/pay-preview" element={<MyPayPreview view="picker" />} />
        <Route path="/admin/pay-preview/:userId" element={<MyPayPreview view="list" />} />
        <Route path="/admin/pay-preview/:userId/:id" element={<MyPayPreview view="statement" />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('My Pay preview', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-10T02:00:00Z'))
    for (const mock of [...Object.values(preview), ...Object.values(own)]) mock.mockReset()
    auth.value = { isClerkEnabled: true, currentUser: { id: 1, role: 'admin', my_pay_enabled: false, my_pay_preview_enabled: true } }
    preview.workers.mockResolvedValue({ workers })
    preview.worker.mockImplementation((id: string) => {
      const worker = workers.find((row) => String(row.id) === id)
      return worker ? Promise.resolve({ worker }) : Promise.reject(new MyPayError("We couldn't find that worker.", 'worker_not_found', 404))
    })
    preview.source.mockReturnValue({ list: preview.list, statement: preview.statement, pdf: preview.pdf })
    window.sessionStorage.clear()
  })
  afterEach(() => vi.useRealTimers())

  describe('gating', () => {
    it('is not available to an admin who is not on the preview allowlist, and loads nothing', () => {
      auth.value = { isClerkEnabled: true, currentUser: { id: 3, role: 'admin', my_pay_enabled: true, my_pay_preview_enabled: false } }
      for (const path of ['/admin/pay-preview', '/admin/pay-preview/12', '/admin/pay-preview/12/42']) {
        const { unmount } = renderAt(path)
        expect(screen.getByText("My Pay preview isn't available for your account.")).toBeVisible()
        expect(screen.queryByRole('region', { name: 'Preview mode' })).not.toBeInTheDocument()
        unmount()
      }
      expect(preview.workers).not.toHaveBeenCalled()
      expect(preview.worker).not.toHaveBeenCalled()
      expect(preview.source).not.toHaveBeenCalled()
      expect(own.list).not.toHaveBeenCalled()
    })

    it('renders nothing until the signed-in user is known', () => {
      auth.value = { isClerkEnabled: true, currentUser: null }
      const { container } = renderAt('/admin/pay-preview')
      expect(container).toBeEmptyDOMElement()
      expect(preview.workers).not.toHaveBeenCalled()
    })
  })

  describe('worker picker', () => {
    it('lists active people with whether their hours reached payroll, and links to each preview', async () => {
      renderAt('/admin/pay-preview')

      expect(screen.getByRole('heading', { level: 1, name: 'Preview My Pay' })).toBeVisible()
      expect(document.title).toBe('Preview My Pay | AIRE Ops')
      const list = await screen.findByRole('list')
      const links = within(list).getAllByRole('link')
      expect(links.map((link) => link.getAttribute('href'))).toEqual(['/admin/pay-preview/12', '/admin/pay-preview/13', '/admin/pay-preview/2'])
      expect(within(links[0]).getByText('Hours sent to payroll')).toBeVisible()
      expect(within(links[2]).getByText('No hours sent to payroll yet')).toBeVisible()
      expect(within(links[2]).getByText('Admin')).toBeVisible()
      expect(screen.getByText('3 active people')).toBeVisible()
    })

    it('searches by name, ignoring case and accents, and remembers the search', async () => {
      const { unmount } = renderAt('/admin/pay-preview')
      await screen.findByRole('list')
      const search = screen.getByLabelText('Find a worker')
      expect(search).toHaveClass('text-base')

      fireEvent.change(search, { target: { value: 'jose' } })
      await waitFor(() => expect(within(screen.getByRole('list')).getAllByRole('link')).toHaveLength(1))
      expect(screen.getByRole('link', { name: /José Pilot/ })).toBeVisible()
      expect(screen.getByText('1 of 3 people')).toBeVisible()
      unmount()

      renderAt('/admin/pay-preview')
      expect(screen.getByLabelText('Find a worker')).toHaveValue('jose')
      await waitFor(() => expect(within(screen.getByRole('list')).getAllByRole('link')).toHaveLength(1))

      fireEvent.change(screen.getByLabelText('Find a worker'), { target: { value: 'nobody' } })
      expect(await screen.findByText('No one matches that name')).toBeVisible()
      fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
      await waitFor(() => expect(within(screen.getByRole('list')).getAllByRole('link')).toHaveLength(3))
    })

    it('offers a retry when the list cannot load', async () => {
      preview.workers.mockRejectedValueOnce(new MyPayError('Pay history is temporarily unavailable. Please try again in a few minutes.', 'my_pay_unavailable', 503))
      renderAt('/admin/pay-preview')
      fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
      expect(await screen.findByRole('link', { name: /Ana Worker/ })).toBeVisible()
      expect(preview.workers).toHaveBeenCalledTimes(2)
    })
  })

  describe('previewing a worker', () => {
    it("shows the persistent banner over the worker's own My Pay list, with preview links", async () => {
      preview.list.mockResolvedValue({ worker: { employment_type: 'contractor', contractor: true }, statements: [summary(), summary({ id: '41', pay_date: '2026-10-31' })] })
      renderAt('/admin/pay-preview/12')

      const banner = screen.getByRole('region', { name: 'Preview mode' })
      expect(banner).toHaveClass('sticky')
      expect(await within(banner).findByText('Ana Worker')).toBeVisible()
      expect(banner).toHaveTextContent('Previewing as Ana Worker · read-only')
      expect(within(banner).getByRole('link', { name: 'Back to workers' })).toHaveAttribute('href', '/admin/pay-preview')

      // The worker's own list screen, with contractor wording, reading the previewed worker.
      expect(await screen.findByRole('heading', { level: 1, name: 'My Pay' })).toBeVisible()
      expect(screen.getByText('Every payment statement from AIRE Services, newest first.')).toBeVisible()
      const links = screen.getAllByRole('link', { name: /Payment for/ })
      expect(links.map((link) => link.getAttribute('href'))).toEqual(['/admin/pay-preview/12/42', '/admin/pay-preview/12/41'])
      expect(preview.source).toHaveBeenCalledWith('12')
      expect(own.list).not.toHaveBeenCalled()
    })

    it("shows the worker's full statement read-only, linking hours to that worker's entries", async () => {
      preview.statement.mockResolvedValue({ worker: { employment_type: 'contractor', contractor: true }, statement: detail() })
      preview.pdf.mockResolvedValue({ blob: new Blob(['%PDF-1.7']), filename: 'AIRE-pay-statement-2026-11-15.pdf' })
      const createObjectURL = vi.fn(() => 'blob:stub')
      Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
      renderAt('/admin/pay-preview/12/42')

      expect(await screen.findByRole('heading', { level: 1, name: 'Payment statement · Nov 15, 2026' })).toBeVisible()
      expect(screen.getByRole('region', { name: 'Preview mode' })).toHaveTextContent('Previewing as Ana Worker')
      expect(preview.statement).toHaveBeenCalledWith('42', expect.any(AbortSignal))
      expect(screen.queryByRole('heading', { name: 'Taxes' })).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'All pay' })).toHaveAttribute('href', '/admin/pay-preview/12')

      const entry = screen.getByRole('link', { name: /Open Tue, Oct 20 time entry in Time & Payroll/ })
      const href = new URL(entry.getAttribute('href') || '', 'https://local.invalid')
      expect(href.pathname).toBe('/admin/time')
      expect(Object.fromEntries(href.searchParams)).toEqual({ user_id: '12', date: '2026-10-20', view: 'day', entry_id: '501', return_to: '/admin/pay-preview/12/42' })

      // Nothing in preview changes data: the only control downloads the stub.
      expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Download PDF stub'])
      fireEvent.click(screen.getByRole('button', { name: 'Download PDF stub' }))
      await waitFor(() => expect(preview.pdf).toHaveBeenCalledWith('42'))
      expect(own.pdf).not.toHaveBeenCalled()
    })

    it("shows My Pay's own not-connected message for a worker payroll doesn't know", async () => {
      preview.list.mockRejectedValue(new MyPayError("Your AIRE account isn't connected to payroll yet. Ask an AIRE administrator to connect it.", 'payroll_not_linked', 404))
      renderAt('/admin/pay-preview/2')

      expect(await screen.findByText('Payroll not connected yet')).toBeVisible()
      expect(screen.getByText("Your AIRE account isn't connected to payroll yet. Ask an AIRE administrator to connect it.")).toBeVisible()
      expect(screen.getByRole('region', { name: 'Preview mode' })).toHaveTextContent('Previewing as Chels Admin')
    })

    it('says so when the worker is not an active team member, without loading pay', async () => {
      renderAt('/admin/pay-preview/999')

      expect(await screen.findByText('Worker not found')).toBeVisible()
      expect(screen.getByRole('link', { name: 'Back to workers' })).toHaveAttribute('href', '/admin/pay-preview')
      expect(preview.list).not.toHaveBeenCalled()
    })
  })
})
