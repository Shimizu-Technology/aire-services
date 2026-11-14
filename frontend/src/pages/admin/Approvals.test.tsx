import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import { payStubsApi, type PayStubRequest } from '../../lib/payStubsApi'
import { approvalsApi } from '../../lib/api/approvals'
import { ToastProvider } from '../../components/ui'
import Approvals from './Approvals'
import { ShellChromeContext } from '../../components/layouts/shellChrome'
import { reviewEntry } from '../../test/approvalFixtures'
const auth = vi.hoisted(() => ({
  currentUser: {
    id: 10,
    approval_group: 'cfi' as string | null,
    time_tracking_enabled: true,
  },
  isClerkEnabled: true,
  userRole: 'manager',
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => auth }))
vi.mock('../../lib/api', () => ({
  api: {
    getUsers: vi.fn(),
    getTimeCategories: vi.fn(),
    getPayrollCutoff: vi.fn(),
    getLeaveRequests: vi.fn(),
    getWhosWorking: vi.fn(),
  },
}))
vi.mock('../../lib/api/approvals', () => ({
  approvalsApi: { pending: vi.fn(), review: vi.fn(), undo: vi.fn() },
}))
vi.mock('../../lib/payStubsApi', () => ({
  payStubsApi: { requests: vi.fn().mockResolvedValue({ requests: [] }) },
}))
vi.mock('./TimeTracking', () => ({
  default: ({ section }: { section: string }) => <p>Classic queue: {section}</p>,
}))
const row = reviewEntry
const rows = [
  row(1, 1),
  row(2, 1),
  row(3, 2),
  row(4, 2, {
    review_kind: 'needs_look',
    exceptions: [{ key: 'overtime', label: 'Overtime' }],
    overtime_status: 'pending',
  }),
  row(5, 10, {
    review_kind: 'needs_look',
    needs_another_approver: true,
    exceptions: [{ key: 'needs_another_approver', label: 'Needs another approver' }],
  }),
]
const response = () => ({
  data: {
    pending_entries: rows,
    count: 5,
    review_summary: {
      complete: true,
      batch_limit: 100,
      ordinary_count: 3,
      ordinary_hours: 24,
      needs_look_count: 2,
      by_person: [],
    },
    pagination: { current_page: 1, total_pages: 1, total_count: 5 },
  },
})
const renderInbox = (url = '/admin/approvals') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <Approvals />
      </ToastProvider>
    </MemoryRouter>,
  )
beforeEach(() => {
  vi.clearAllMocks()
  auth.userRole = 'manager'
  auth.currentUser.approval_group = 'cfi'
  vi.mocked(payStubsApi.requests).mockResolvedValue({ requests: [], open_count: 0 })
  localStorage.clear()
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  vi.mocked(api.getUsers).mockResolvedValue({
    data: {
      users: [],
      approval_groups: [
        { key: 'cfi', label: 'CFI' },
        { key: 'ops', label: 'Ops/Maint' },
      ],
    },
  })
  vi.mocked(api.getTimeCategories).mockResolvedValue({ data: { time_categories: [] } })
  vi.mocked(api.getPayrollCutoff).mockResolvedValue({ error: 'No published period' })
  vi.mocked(api.getLeaveRequests).mockResolvedValue({
    data: {
      leave_requests: [],
      pagination: { current_page: 1, per_page: 100, total_count: 0, total_pages: 1 },
    },
  })
  vi.mocked(api.getWhosWorking).mockResolvedValue({ data: { workers: [] } })
  vi.mocked(approvalsApi.pending).mockResolvedValue(response())
  vi.mocked(approvalsApi.review).mockResolvedValue({
    data: {
      review_batch_id: 'one',
      undo_expires_at: '2026-11-14T00:00:00Z',
      approved_count: 2,
      time_entries: [],
    },
  })
})
describe('Approvals inbox', () => {
  it('approves exactly the displayed person group, excluding overtime and own time', async () => {
    renderInbox()
    await screen.findByText('Ordinary shifts · 3 · 24.0h')
    fireEvent.click(
      screen.getByRole('button', { name: 'Approve 2 shifts for Marcus Quinata' }),
    )
    await waitFor(() => expect(approvalsApi.review).toHaveBeenCalledOnce())
    expect(vi.mocked(approvalsApi.review).mock.calls[0][0]).toEqual([
      { id: 1, version: 11, approve_time: true, approve_overtime: false },
      { id: 2, version: 12, approve_time: true, approve_overtime: false },
    ])
    expect(screen.getByText('Needs another approver')).toBeInTheDocument()
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Approve 1 shift for Grace Torres' }),
      ).toHaveFocus(),
    )
  })
  it('confirms all using the same snapshot, naming exclusions', async () => {
    renderInbox()
    fireEvent.click(await screen.findByRole('button', { name: 'Approve all 3' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('Overtime')
    expect(dialog).toHaveTextContent('Needs another approver')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve 3 shifts' }))
    await waitFor(() => expect(approvalsApi.review).toHaveBeenCalledOnce())
    expect(
      vi.mocked(approvalsApi.review).mock.calls[0][0].map((item) => [item.id, item.version]),
    ).toEqual([
      [1, 11],
      [2, 12],
      [3, 13],
    ])
  })
  it('supports roving rows, Space, Enter, Esc, Shift+A confirm and no single-key approve', async () => {
    const user = userEvent.setup()
    renderInbox()
    await screen.findByText('Ordinary shifts · 3 · 24.0h')
    const list = screen.getByRole('list', { name: 'Ordinary shifts by person' })
    const first = list.querySelector<HTMLElement>('[data-list-row]')!
    first.focus()
    await user.keyboard('{Enter}')
    expect(
      screen.getAllByRole('checkbox', { name: 'Select Marcus Quinata, 2026-11-10' }),
    ).toHaveLength(2)
    await user.keyboard(' ')
    expect(screen.getByRole('region', { name: 'Selected shifts' })).toHaveTextContent(
      '2 shifts',
    )
    await user.keyboard('a')
    expect(approvalsApi.review).not.toHaveBeenCalled()
    await user.keyboard('{Shift>}a{/Shift}')
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Approve 2 shifts?')
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }),
    )
    first.focus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('region', { name: 'Selected shifts' })).not.toBeInTheDocument()
    first.focus()
    await user.keyboard('j')
    expect(document.activeElement?.textContent).toContain('Nov')
  })
  it('confirms a cross-person selection and sends exactly those rows', async () => {
    renderInbox()
    await screen.findByText('Ordinary shifts · 3 · 24.0h')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Marcus Quinata' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Grace Torres' }))
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Selected shifts' })).getByRole('button', {
        name: 'Approve 3',
      }),
    )
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Approve 3 shifts',
      }),
    )
    await waitFor(() => expect(approvalsApi.review).toHaveBeenCalledOnce())
    expect(vi.mocked(approvalsApi.review).mock.calls[0][0].map((item) => item.id)).toEqual([
      1, 2, 3,
    ])
  })
  it('disables saving while offline with the reason', async () => {
    renderInbox()
    await screen.findByText('Ordinary shifts · 3 · 24.0h')
    act(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
      window.dispatchEvent(new Event('offline'))
    })
    expect(screen.getByRole('button', { name: 'Approve all 3' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Approve all 3' })).toHaveAttribute(
      'title',
      'Reconnect to approve',
    )
  })
  it('renders the unchanged classic route element', async () => {
    renderInbox('/admin/approvals?classic=1')
    expect(await screen.findByText('Classic queue: approvals')).toBeInTheDocument()
    expect(approvalsApi.pending).not.toHaveBeenCalled()
  })
})

const stubRequest: PayStubRequest = {
  id: 1,
  status: 'open',
  source: 'kiosk',
  scope: 'latest',
  statement_id: null,
  pay_date: null,
  year: null,
  worker: {
    id: 1,
    name: 'Marcus Quinata',
    first_name: 'Marcus',
    role: 'employee',
    on_file_email: null,
  },
  recipient_kind: 'typed',
  recipient_email: 'qa@aire.test',
  can_send: false,
  requested_at: '2026-11-14T00:00:00Z',
  resolved_at: null,
  resolved_by: null,
  resolution_note: null,
  links: [],
}

it('hides the Pay stubs chip for a zero visible count and falls back from kind=stubs to Time', async () => {
  vi.mocked(payStubsApi.requests).mockResolvedValue({
    requests: [stubRequest],
    open_count: 1,
  })
  renderInbox('/admin/approvals?kind=stubs&user_id=10')
  await screen.findByText('Ordinary shifts · 3 · 24.0h')
  expect(screen.queryByRole('tab', { name: /Pay stubs/ })).not.toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'Time 5' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.queryByRole('list', { name: 'Pay stub requests' })).not.toBeInTheDocument()
})

it('shows Pay stubs only when the viewer can send them and visible requests exist', async () => {
  vi.mocked(payStubsApi.requests).mockResolvedValue({
    requests: [stubRequest],
    open_count: 1,
  })
  renderInbox('/admin/approvals?kind=stubs&user_id=1&dept=all')
  expect(await screen.findByRole('tab', { name: 'Pay stubs 1' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  expect(
    await screen.findByText('An owner or admin needs to send this one'),
  ).toBeInTheDocument()
})

it('asks before approving a By day group spanning people', async () => {
  renderInbox('/admin/approvals?group=day')
  fireEvent.click(await screen.findByRole('button', { name: /Approve 3 shifts for/ }))
  expect(approvalsApi.review).not.toHaveBeenCalled()
  expect(screen.getByRole('alertdialog')).toHaveTextContent('2 people')
  fireEvent.click(
    within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Approve 3 shifts' }),
  )
  await waitFor(() => expect(approvalsApi.review).toHaveBeenCalledOnce())
})

it('group approval removes only its committed IDs from a cross-person selection', async () => {
  renderInbox()
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Marcus Quinata' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Grace Torres' }))
  fireEvent.click(screen.getByRole('button', { name: 'Approve 2 shifts for Marcus Quinata' }))
  await waitFor(() =>
    expect(screen.getByRole('region', { name: 'Selected shifts' })).toHaveTextContent(
      '1 shift',
    ),
  )
  expect(screen.getByRole('checkbox', { name: 'Select Grace Torres' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Select Marcus Quinata' })).not.toBeChecked()
})

it('keeps the full disabled reason on a Shift+A confirmation after going offline', async () => {
  const user = userEvent.setup()
  renderInbox()
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Marcus Quinata' }))
  const row = screen
    .getByRole('list', { name: 'Ordinary shifts by person' })
    .querySelector<HTMLElement>('[data-list-row]')!
  row.focus()
  await user.keyboard('{Shift>}a{/Shift}')
  act(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    window.dispatchEvent(new Event('offline'))
  })
  const confirm = within(screen.getByRole('alertdialog')).getByRole('button', {
    name: 'Approve 2 shifts',
  })
  expect(confirm).toBeDisabled()
  expect(confirm).toHaveAttribute('title', 'Reconnect to approve')
})

it.each(['leave', 'stubs'])(
  'waits for people and shows retryable errors for kind=%s',
  async (kind) => {
    let resolve!: (value: Awaited<ReturnType<typeof api.getUsers>>) => void
    vi.mocked(api.getUsers).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    renderInbox(`/admin/approvals?kind=${kind}&dept=cfi`)
    expect(await screen.findByText('Loading departments and people…')).toBeInTheDocument()
    expect(screen.queryByText('No leave requests waiting.')).not.toBeInTheDocument()
    await act(async () => resolve({ error: "Couldn't load departments and people." }))
    expect(
      await screen.findByText("Couldn't load departments and people."),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(api.getUsers).toHaveBeenCalledTimes(2))
  },
)

it('drops a remembered department that no longer exists', async () => {
  localStorage.setItem('aire.approvals.department.10', 'removed-team')
  renderInbox('/admin/approvals?kind=leave')
  await waitFor(() =>
    expect(localStorage.getItem('aire.approvals.department.10')).toBe('all'),
  )
  expect(screen.getByRole('tab', { name: 'Everyone' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
})

it('links tracking supervisors to their own leave page from the Leave chip', async () => {
  renderInbox('/admin/approvals?kind=leave')
  expect(await screen.findByRole('link', { name: 'Request your own leave' })).toHaveAttribute(
    'href',
    '/admin/leave?mine=1',
  )
})

it.each(['gone', 'needs-look'])(
  'prunes invisible selection after a 409 when selected rows are %s',
  async (changed) => {
    const refreshed = response()
    refreshed.data.pending_entries = rows.filter((row) => row.id > 2)
    if (changed === 'needs-look')
      refreshed.data.pending_entries.push({
        ...rows[0],
        review_kind: 'needs_look',
        exceptions: [{ key: 'edited', label: 'Edited elsewhere' }],
      })
    vi.mocked(approvalsApi.pending)
      .mockResolvedValueOnce(response())
      .mockResolvedValue(refreshed)
    vi.mocked(approvalsApi.review).mockResolvedValueOnce({
      status: 409,
      error: 'These shifts changed. Nothing was approved.',
    })
    renderInbox()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Marcus Quinata' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Approve 2 shifts for Marcus Quinata' }),
    )
    await waitFor(() => expect(approvalsApi.pending).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: 'Selected shifts' }),
      ).not.toBeInTheDocument(),
    )
    const calls = vi.mocked(approvalsApi.pending).mock.calls.length
    act(() => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(approvalsApi.pending).toHaveBeenCalledTimes(calls + 1))
    fireEvent.click(screen.getByRole('tab', { name: 'By day' }))
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'By day' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  },
)

it.each([
  [
    'finalized past period',
    '2026-10-16',
    '2026-10-31',
    '2026-11-09T13:23:00Z',
    'none',
    false,
  ],
  ['no period', null, null, null, 'none', false],
  ['upcoming period', '2099-11-01', '2099-11-15', '2099-11-18T07:00:00Z', 'none', true],
  [
    'lock in progress',
    '2020-11-01',
    '2020-11-15',
    '2020-11-18T07:00:00Z',
    'finalizing',
    true,
  ],
] as const)('describes only an active lock: %s', async (_, start, end, at, stage, active) => {
  vi.mocked(api.getPayrollCutoff).mockResolvedValue({
    data: {
      cutoff: {
        period: start && end ? { id: 1, start_date: start, end_date: end } : null,
        publication_id: 'published',
        version: 1,
        cutoff_at: at,
        stage,
        now: new Date().toISOString(),
        seconds_remaining: active ? 100 : -100,
        time_zone: 'Pacific/Guam',
      },
    },
  })
  renderInbox()
  fireEvent.click(await screen.findByRole('button', { name: 'Approve all 3' }))
  const dialog = screen.getByRole('alertdialog')
  if (!active) {
    expect(screen.getByText('5 waiting')).toBeInTheDocument()
    expect(dialog).toHaveTextContent("They'll go to payroll at the next lock.")
    expect(dialog).not.toHaveTextContent('Nov 9')
  } else if (stage === 'finalizing') {
    expect(screen.getByText(/5 waiting.*Locking now/)).toBeInTheDocument()
    expect(dialog).toHaveTextContent('at the lock now in progress.')
  } else {
    expect(screen.getByText(/5 waiting.*locks Wed, Nov 18, 5:00 PM/)).toBeInTheDocument()
    expect(dialog).toHaveTextContent('at the Wed, Nov 18, 5:00 PM lock.')
  }
})

it('keeps zero-hour pending overtime out of every ordinary approval payload', async () => {
  renderInbox()
  expect(await screen.findByText(/Overtime to review/)).toBeInTheDocument()
  expect(screen.queryByText(/0.0h overtime this week/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Approve all 3' }))
  fireEvent.click(screen.getByRole('button', { name: 'Approve 3 shifts' }))
  await waitFor(() => expect(approvalsApi.review).toHaveBeenCalledOnce())
  expect(vi.mocked(approvalsApi.review).mock.calls[0][0].map((item) => item.id)).toEqual([
    1, 2, 3,
  ])
})

it('defaults to the manager department, follows its clock banners, and shows the configured hour limit', async () => {
  auth.currentUser.approval_group = null
  const { data } = response()
  vi.mocked(approvalsApi.pending).mockResolvedValue({
    data: {
      ...data,
      review_summary: { ...data.review_summary, ordinary_max_shift_hours: 10 },
    },
  })
  const person = (id: number, group: string) => ({
    id,
    full_name: `Clock Person ${id}`,
    approval_group_keys: [group],
  })
  vi.mocked(api.getUsers).mockResolvedValue({
    data: {
      users: [
        person(1, 'cfi'),
        person(2, 'ops'),
        person(10, 'cfi'),
      ] as import('../../lib/api').UserSummary[],
      approval_groups: [
        { key: 'cfi', label: 'CFI' },
        { key: 'ops', label: 'Ops/Maint' },
      ],
    },
  })
  vi.mocked(api.getWhosWorking).mockResolvedValue({
    data: {
      workers: [1, 2].map((id) => ({
        user: { id, full_name: `Clock Person ${id}` },
        open_since_work_date: '2026-11-11',
        open_entry_id: id,
        clock_in_at: '2026-11-11T03:30:00Z',
      })) as import('../../lib/api').WorkerStatus[],
    },
  })
  renderInbox()
  await screen.findByText(/under 10 hours/)
  expect(approvalsApi.pending).toHaveBeenCalledWith(
    expect.objectContaining({ approval_group: 'cfi' }),
  )
  expect(screen.getByRole('tab', { name: 'CFI' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByText('Clock Person 1')).toBeInTheDocument()
  expect(screen.queryByText('Clock Person 2')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: 'Everyone' }))
  expect(await screen.findByText('Clock Person 2')).toBeInTheDocument()
})

it('explains default badge versus Today and keeps Everyone and Unassigned directly available', async () => {
  const refresh = vi.fn()
  render(
    <MemoryRouter initialEntries={['/admin/approvals?user_id=1&time_category_id=2']}>
      <ShellChromeContext.Provider
        value={{
          selectionBarActive: false,
          registerSelectionBar: () => () => undefined,
          approvalCount: 7,
          allApprovalCount: 10,
          refreshApprovalCount: refresh,
        }}
      >
        <ToastProvider>
          <Approvals />
        </ToastProvider>
      </ShellChromeContext.Provider>
    </MemoryRouter>,
  )
  expect(
    await screen.findByText(
      'The badge counts all 7 waiting in CFI. 3 more waiting in other departments. Today counts everyone.',
    ),
  ).toBeInTheDocument()
  await waitFor(() => expect(refresh).toHaveBeenCalled())
  expect(screen.getByRole('tablist', { name: 'Department' })).toHaveClass('flex-wrap')
  fireEvent.click(screen.getByRole('tab', { name: 'Unassigned' }))
  await waitFor(() =>
    expect(approvalsApi.pending).toHaveBeenCalledWith(
      expect.objectContaining({ approval_group: 'unassigned' }),
    ),
  )
  fireEvent.click(screen.getByRole('tab', { name: 'Everyone' }))
  await waitFor(() =>
    expect(vi.mocked(approvalsApi.pending).mock.lastCall?.[0].approval_group).toBeUndefined(),
  )
})
