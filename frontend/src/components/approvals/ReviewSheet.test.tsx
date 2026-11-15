import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ReviewSheet from './ReviewSheet'
import { reviewEntry } from '../../test/approvalFixtures'
import { api } from '../../lib/api'
import { approvalsApi } from '../../lib/api/approvals'
vi.mock('../../lib/api', () => ({
  api: {
    getTimeEntry: vi.fn(),
    getTimeEntries: vi.fn(),
    denyTimeEntry: vi.fn(),
    denyOvertime: vi.fn(),
    rejectTimeEntryChange: vi.fn(),
  },
}))
vi.mock('../../lib/api/approvals', () => ({ approvalsApi: { history: vi.fn(), pending: vi.fn() } }))
vi.mock('../time-tracking/EditTimeEntryModal', () => ({
  default: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div role="dialog" aria-label="Edit shift">
        <button onClick={onClose}>Back to review</button>
      </div>
    ) : null,
}))
const props = () => ({
  entry: reviewEntry(7, 1, {
    review_kind: 'needs_look',
    exceptions: [{ key: 'edited', label: 'Edited' }],
    approval_note:
      'Clocked in without a schedule | Employee edited time entry — awaiting admin review | Please check my finish time',
  }),
  onClose: vi.fn(),
  onApprove: vi.fn().mockResolvedValue('ok'),
  onReload: vi.fn(),
  busy: false,
  categories: [],
  onDirty: vi.fn(),
})
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-06T12:00:00Z'))
})
afterEach(() => vi.useRealTimers())

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(approvalsApi.history).mockResolvedValue({ data: { entry_id: 7, changes: [] } })
  vi.mocked(approvalsApi.pending).mockResolvedValue({ data: { pending_entries: [reviewEntry(7, 1, { version: 18, description: 'New shift facts', exceptions: [{ key: 'added', label: 'Added by hand' }] })] } } as never)
  vi.mocked(api.getTimeEntry).mockResolvedValue({ data: { time_entry: reviewEntry(7, 1) } })
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  vi.mocked(api.getTimeEntries).mockResolvedValue({
    data: {
      time_entries: [],
      pagination: { current_page: 1, per_page: 500, total_count: 0, total_pages: 1 },
      summary: { total_hours: 0, total_break_hours: 0, entry_count: 0 },
    },
  })
})
it('shows recorded before/after, actor, reason and time, without inventing values', async () => {
  vi.mocked(approvalsApi.history).mockResolvedValue({
    data: {
      entry_id: 7,
      changes: [
        {
          action: 'time_entry.updated',
          at: '2026-11-10T08:00:00Z',
          actor: { id: 3, full_name: 'Roke Aguon' },
          sentence: 'Roke edited this shift',
          reason: 'Fixed missed clock-out',
          fields: [{ field: 'hours', label: 'Hours', before: 7, after: 8 }],
        },
      ],
    },
  })
  render(<ReviewSheet {...props()} />)
  expect(await screen.findByText('Hours: 7 → 8')).toBeInTheDocument()
  expect(screen.getByText(/Reason: Fixed missed clock-out/)).toBeInTheDocument()
  expect(screen.getByText(/Roke Aguon ·/)).toBeInTheDocument()
})
it('keeps current values, note and decisions usable after a history failure, and retries', async () => {
  vi.mocked(approvalsApi.history)
    .mockResolvedValueOnce({ error: 'Unavailable' })
    .mockResolvedValueOnce({ data: { entry_id: 7, changes: [] } })
  const config = props()
  render(<ReviewSheet {...config} />)
  expect(await screen.findByText("Couldn't load the change history.")).toBeInTheDocument()
  expect(screen.getByText('Please check my finish time')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Approve time' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('No change history recorded.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Approve time' }))
  await waitFor(() =>
    expect(config.onApprove).toHaveBeenCalledWith(
      [{ id: 7, version: 17, approve_time: true, approve_overtime: false }],
      expect.any(String),
    ),
  )
})
it('requires a note for denial and preserves server errors', async () => {
  vi.mocked(approvalsApi.history).mockResolvedValue({ data: { entry_id: 7, changes: [] } })
  vi.mocked(api.denyTimeEntry).mockResolvedValue({ error: 'The period has locked.' })
  render(<ReviewSheet {...props()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Deny…' }))
  expect(screen.getByRole('button', { name: 'Deny shift' })).toBeDisabled()
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'Please correct this shift.' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Deny shift' }))
  expect(await screen.findByText('The period has locked.')).toBeInTheDocument()
  expect(api.denyTimeEntry).toHaveBeenCalledWith(7, 'Please correct this shift.', 17)
})

it('blocks decisions after an unknown outcome and offers Reload without claiming rejection', async () => {
  vi.mocked(approvalsApi.history).mockResolvedValue({ data: { entry_id: 7, changes: [] } })
  const config = props()
  config.onApprove.mockResolvedValue('unknown')
  render(<ReviewSheet {...config} />)
  fireEvent.click(screen.getByRole('button', { name: 'Approve time' }))
  expect(
    await screen.findByText(
      "We couldn't confirm whether this saved. Reload before deciding again.",
    ),
  ).toBeInTheDocument()
  expect(screen.queryByText(/could not be saved/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Approve time' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
  await waitFor(() => expect(config.onReload).toHaveBeenCalled())
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Approve time' })).toBeEnabled(),
  )
  expect(api.getTimeEntry).toHaveBeenCalledWith(7)
})

it('keeps the denial note on the fresh classified review after a preflight mismatch', async () => {
  vi.mocked(approvalsApi.history).mockResolvedValue({ data: { entry_id: 7, changes: [] } })
  vi.mocked(api.getTimeEntry).mockResolvedValue({ data: { time_entry: reviewEntry(7, 1, { version: 18 }) } })
  const config = props()
  render(<ReviewSheet {...config} />)
  fireEvent.click(screen.getByRole('button', { name: 'Deny…' }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Stale note' } })
  fireEvent.click(screen.getByRole('button', { name: 'Deny shift' }))
  expect(await screen.findByText('New shift facts')).toBeInTheDocument()
  expect(screen.getByRole('textbox')).toHaveValue('Stale note')
  expect(screen.getByText('Added by hand')).toBeInTheDocument()
  expect(screen.queryByText('Edited')).not.toBeInTheDocument()
  expect(config.onClose).not.toHaveBeenCalled()
  expect(api.denyTimeEntry).not.toHaveBeenCalled()
  expect(config.onReload).toHaveBeenCalledOnce()
})

it('names time as well as overtime when both decisions are pending', async () => {
  vi.mocked(approvalsApi.history).mockResolvedValue({ data: { entry_id: 7, changes: [] } })
  const config = props()
  config.entry = { ...config.entry, overtime_status: 'pending', pending_overtime_hours: 6 }
  render(<ReviewSheet {...config} />)
  fireEvent.click(screen.getByRole('button', { name: 'Approve time + 6.0h overtime' }))
  await waitFor(() =>
    expect(config.onApprove).toHaveBeenCalledWith(
      [{ id: 7, version: 17, approve_time: true, approve_overtime: true, overtime_hours: 6 }],
      expect.any(String),
    ),
  )
})

it('hands the active dialog to the editor and restores review when editing closes', async () => {
  vi.mocked(approvalsApi.history).mockResolvedValue({ data: { entry_id: 7, changes: [] } })
  render(<ReviewSheet {...props()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit…' }))
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(screen.getByRole('dialog', { name: 'Edit shift' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Back to review' }))
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(screen.getByRole('dialog', { name: 'Review Marcus Quinata' })).toBeInTheDocument()
})

it('closes an unknown decision as Saved only when replay confirms its saved version', async () => {
  vi.mocked(approvalsApi.history).mockResolvedValue({ data: { entry_id: 7, changes: [] } })
  const config = props()
  config.onApprove.mockResolvedValue('unknown')
  config.onReload.mockResolvedValue(new Map([[7, 18]]))
  vi.mocked(api.getTimeEntry).mockResolvedValue({
    data: { time_entry: reviewEntry(7, 1, { version: 18, approval_status: 'approved' }) },
  })
  render(<ReviewSheet {...config} />)
  fireEvent.click(screen.getByRole('button', { name: 'Approve time' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Reload' }))
  await waitFor(() => expect(config.onClose).toHaveBeenCalledWith(true, 'Saved'))
})

it('closes a changed unknown decision without merging stale exceptions or overtime fields', async () => {
  vi.mocked(approvalsApi.history).mockResolvedValue({ data: { entry_id: 7, changes: [] } })
  const config = props()
  config.onApprove.mockResolvedValue('unknown')
  vi.mocked(api.getTimeEntry).mockResolvedValue({
    data: {
      time_entry: reviewEntry(7, 1, { version: 18, description: 'Changed after opening' }),
    },
  })
  render(<ReviewSheet {...config} />)
  fireEvent.click(screen.getByRole('button', { name: 'Approve time' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Reload' }))
  await waitFor(() =>
    expect(config.onClose).toHaveBeenCalledWith(
      true,
      'This shift changed since this approval attempt. Review its current values before deciding again.',
    ),
  )
  expect(screen.queryByText('Changed after opening')).not.toBeInTheDocument()
})

it('closes a conflicted approval so it must reopen with fresh review fields', async () => {
  vi.mocked(approvalsApi.history).mockResolvedValue({ data: { entry_id: 7, changes: [] } })
  const config = props()
  config.onApprove.mockResolvedValue('conflict')
  render(<ReviewSheet {...config} />)
  fireEvent.click(screen.getByRole('button', { name: 'Approve time' }))
  await waitFor(() =>
    expect(config.onClose).toHaveBeenCalledWith(
      true,
      'This shift changed since you opened it. Nothing was approved.',
    ),
  )
})


it.each(['time', 'overtime'] as const)('preserves the note and uses the fresh version after a server stale %s denial', async (kind) => {
  vi.mocked(approvalsApi.history).mockResolvedValue({ data: { entry_id: 7, changes: [] } })
  const config = props()
  const fresh = reviewEntry(7, 1, { version: 18, description: 'New shift facts', exceptions: [{ key: 'added', label: 'Added by hand' }],
    ...(kind === 'overtime' ? { approval_status: 'approved', overtime_status: 'pending', pending_overtime_hours: 3 } : {}) })
  if (kind === 'overtime') config.entry = reviewEntry(7, 1, { approval_status: 'approved', overtime_status: 'pending', pending_overtime_hours: 2 })
  vi.mocked(approvalsApi.pending).mockResolvedValue({ data: { pending_entries: [fresh] } } as never)
  vi.mocked(api.getTimeEntry).mockResolvedValueOnce({ data: { time_entry: config.entry } }).mockResolvedValue({ data: { time_entry: fresh } })
  const deny = kind === 'overtime' ? api.denyOvertime : api.denyTimeEntry
  vi.mocked(deny).mockResolvedValueOnce({ status: 409, code: 'stale_entry', error: 'Changed' }).mockResolvedValue({ data: { time_entry: fresh } })
  render(<ReviewSheet {...config} />)
  fireEvent.click(screen.getByRole('button', { name: kind === 'overtime' ? 'Deny overtime…' : 'Deny…' }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Stale denial' } })
  const label = kind === 'overtime' ? 'Deny overtime' : 'Deny shift'
  fireEvent.click(screen.getByRole('button', { name: label }))
  expect(await screen.findByText('New shift facts')).toBeInTheDocument()
  expect(screen.getByRole('textbox')).toHaveValue('Stale denial')
  expect(screen.getByText('Added by hand')).toBeInTheDocument()
  expect(config.onClose).not.toHaveBeenCalled()
  expect(deny).toHaveBeenCalledWith(7, 'Stale denial', 17)
  expect(config.onDirty).toHaveBeenLastCalledWith(true)
  fireEvent.click(screen.getByRole('button', { name: label }))
  await waitFor(() => expect(deny).toHaveBeenLastCalledWith(7, 'Stale denial', 18))
})

it('keeps the denial note and blocks decisions when conflict reload fails', async () => {
  vi.mocked(approvalsApi.history).mockResolvedValue({ data: { entry_id: 7, changes: [] } })
  vi.mocked(api.denyTimeEntry).mockResolvedValue({ status: 409, code: 'stale_entry', error: 'Changed' })
  vi.mocked(approvalsApi.pending).mockResolvedValue({ error: 'Unavailable' })
  render(<ReviewSheet {...props()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Deny…' }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep this explanation' } })
  fireEvent.click(screen.getByRole('button', { name: 'Deny shift' }))
  expect(await screen.findByText('Unavailable')).toBeInTheDocument()
  expect(screen.getByRole('textbox')).toHaveValue('Keep this explanation')
  expect(screen.getByRole('button', { name: 'Deny shift' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Reload shift' })).toBeEnabled()
})

it('reloads the queue and announces the denied shift and visible note', async () => {
  vi.mocked(approvalsApi.history).mockResolvedValue({ data: { entry_id: 7, changes: [] } })
  vi.mocked(api.denyTimeEntry).mockResolvedValue({
    data: { time_entry: reviewEntry(7, 1, { approval_status: 'denied' }) },
  })
  const config = props()
  render(<ReviewSheet {...config} />)
  fireEvent.click(screen.getByRole('button', { name: 'Deny…' }))
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'Please correct this shift.' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Deny shift' }))
  await waitFor(() =>
    expect(config.onClose).toHaveBeenCalledWith(
      true,
      expect.stringMatching(
        /Denied Marcus Quinata's Tue, Nov 10.*shift\. They'll see your note\./,
      ),
    ),
  )
  expect(config.onReload).toHaveBeenCalledOnce()
})

it('focuses and scrolls to the note and explains the disabled denial', () => {
  vi.mocked(approvalsApi.history).mockResolvedValue({ data: { entry_id: 7, changes: [] } })
  const scroll = vi.fn()
  const original = HTMLElement.prototype.scrollIntoView
  HTMLElement.prototype.scrollIntoView = scroll
  try {
    render(<ReviewSheet {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Deny…' }))
    expect(screen.getByRole('textbox')).toHaveFocus()
    expect(scroll).toHaveBeenCalledWith({ block: 'center' })
    expect(screen.getByText('Write a short note for Marcus to deny.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deny shift' })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Wrong punches' } })
    expect(
      screen.queryByText('Write a short note for Marcus to deny.'),
    ).not.toBeInTheDocument()
  } finally {
    HTMLElement.prototype.scrollIntoView = original
  }
})

it('uses human status/work labels and hides machine annotations while keeping the personal note', async () => {
  vi.mocked(approvalsApi.history).mockResolvedValue({ data: { entry_id: 7, changes: [] } })
  const config = props()
  config.entry = { ...config.entry, overtime_status: 'pending', pending_overtime_hours: 0 }
  vi.mocked(api.getTimeEntries).mockResolvedValue({
    data: {
      time_entries: [reviewEntry(8, 1)],
      pagination: { current_page: 1, per_page: 500, total_count: 1, total_pages: 1 },
      summary: { total_hours: 8, total_break_hours: 0, entry_count: 1 },
    },
  })
  render(<ReviewSheet {...config} />)
  expect(screen.getByText('Work:')).toBeInTheDocument()
  expect(screen.getByText('Waiting for approval')).toBeInTheDocument()
  expect(await screen.findByText(/8.0h · Waiting for approval/)).toBeInTheDocument()
  expect(screen.getByText('Please check my finish time')).toBeInTheDocument()
  expect(screen.queryByText(/Clocked in without a schedule/)).not.toBeInTheDocument()
  expect(screen.queryByText(/awaiting admin review/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Approve time + overtime' })).toBeInTheDocument()
})

it('navigates the person week while keeping decisions on the selected shift', async () => {
  vi.mocked(approvalsApi.history).mockResolvedValue({ data: { entry_id: 7, changes: [] } })
  const config = props()
  const another = reviewEntry(8, 1, { work_date: '2026-11-11' })
  const select = vi.fn()
  render(
    <ReviewSheet {...config} weekEntries={[config.entry, another]} onSelectEntry={select} />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Wed, Nov 11 · 8.0h/ }))
  expect(select).toHaveBeenCalledWith(another)
  fireEvent.click(screen.getByRole('button', { name: 'Approve time' }))
  await waitFor(() =>
    expect(config.onApprove).toHaveBeenCalledWith(
      [{ id: 7, version: 17, approve_time: true, approve_overtime: false }],
      expect.any(String),
    ),
  )
})

it('does not report Saved when another approver changed and approved uncertain overtime', async () => {
  vi.mocked(approvalsApi.history).mockResolvedValue({ data: { entry_id: 7, changes: [] } })
  const config = props()
  config.entry = { ...config.entry, overtime_status: 'pending', pending_overtime_hours: 6 }
  config.onApprove.mockResolvedValue('unknown')
  vi.mocked(api.getTimeEntry).mockResolvedValue({
    data: {
      time_entry: reviewEntry(7, 1, {
        version: 21,
        approval_status: 'approved',
        overtime_status: 'approved',
        hours: 4,
      }),
    },
  })
  render(<ReviewSheet {...config} />)
  fireEvent.click(screen.getByRole('button', { name: 'Approve time + 6.0h overtime' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Reload' }))
  await waitFor(() =>
    expect(config.onClose).toHaveBeenCalledWith(
      true,
      'This shift changed since this approval attempt. Review its current values before deciding again.',
    ),
  )
  expect(config.onClose).not.toHaveBeenCalledWith(true, 'Saved')
})


it('preserves annotation-like words inside personal reasons and removes only complete annotations', async () => {
  vi.mocked(approvalsApi.history).mockResolvedValue({ data: { entry_id: 7, changes: [] } })
  const config = props()
  config.entry.approval_note =
    'Denied: Employee edited time entry after cutoff | Clocked in without a schedule by mistake\n\nEmployee edited time entry — awaiting admin review'
  render(<ReviewSheet {...config} />)
  expect(await screen.findByText(
    'Denied: Employee edited time entry after cutoff · Clocked in without a schedule by mistake',
  )).toBeInTheDocument()
  expect(screen.queryByText(/awaiting admin review/)).not.toBeInTheDocument()
})

const changedClockProps = () => {
  const config = props()
  config.entry = {
    ...config.entry,
    entry_method: 'clock',
    original_employee_change: {
      formatted_range: 'Fri, Nov 13, 7:00 AM–1:20 PM',
      start_time: '07:00',
      end_time: '13:20',
      clock_in_at: null,
      clock_out_at: null,
      hours: 6.33,
    },
  }
  return config
}
it('shows original and three choices and approves the requested change', async () => {
  const config = changedClockProps()
  render(<ReviewSheet {...config} />)
  expect(
    screen.getByText(/Original: Fri, Nov 13, 7:00 AM–1:20 PM · Marcus asked for/),
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Keep the original time' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Deny the whole shift…' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Approve the change' }))
  await waitFor(() =>
    expect(config.onApprove).toHaveBeenCalledWith(
      [{ id: 7, version: 17, approve_time: true, approve_overtime: false }],
      expect.any(String),
    ),
  )
})
it('requires a reason, refreshes restored pending time, and never approves or denies it', async () => {
  vi.mocked(api.rejectTimeEntryChange).mockResolvedValue({
    data: { time_entry: reviewEntry(7, 1) },
  })
  const config = changedClockProps()
  render(<ReviewSheet {...config} />)
  fireEvent.click(screen.getByRole('button', { name: 'Keep the original time' }))
  expect(screen.getByRole('textbox')).toHaveFocus()
  expect(screen.getByRole('button', { name: 'Keep the original time' })).toBeDisabled()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } })
  expect(screen.getByRole('button', { name: 'Keep the original time' })).toBeDisabled()
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: ' Original punches are correct. ' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Keep the original time' }))
  await waitFor(() =>
    expect(config.onClose).toHaveBeenCalledWith(
      true,
      expect.stringContaining('Still waiting for approval.'),
    ),
  )
  expect(api.rejectTimeEntryChange).toHaveBeenCalledWith(
    7,
    17,
    'Original punches are correct.',
  )
  expect(config.onReload).toHaveBeenCalledOnce()
  expect(config.onApprove).not.toHaveBeenCalled()
  expect(api.denyTimeEntry).not.toHaveBeenCalled()
})
it.each([
  [
    409,
    'payroll_busy',
    'Payroll is working on this period right now. Try again in a minute. Nothing was changed.',
  ],
  [
    422,
    undefined,
    "The original time couldn't be restored. Ask a manager to correct this shift. The requested change is still waiting.",
  ],
])('announces refusal %s %s through the inbox toast', async (status, code, message) => {
  vi.mocked(api.rejectTimeEntryChange).mockResolvedValue({
    error: 'Server refusal',
    status,
    code,
  })
  const config = changedClockProps()
  render(<ReviewSheet {...config} />)
  fireEvent.click(screen.getByRole('button', { name: 'Keep the original time' }))
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'Check original' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Keep the original time' }))
  await waitFor(() => expect(config.onClose).toHaveBeenCalledWith(true, message))
  expect(config.onReload).toHaveBeenCalledOnce()
})
it('warns that whole-shift denial removes all hours and requires its reason', async () => {
  vi.mocked(api.denyTimeEntry).mockResolvedValue({
    data: { time_entry: reviewEntry(7, 1, { approval_status: 'denied' }) },
  })
  render(<ReviewSheet {...changedClockProps()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Deny the whole shift…' }))
  expect(screen.getByRole('alert')).toHaveTextContent(
    'no hours from this shift will count',
  )
  expect(screen.getByRole('button', { name: 'Deny the whole shift' })).toBeDisabled()
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'No work occurred' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Deny the whole shift' }))
  await waitFor(() =>
    expect(api.denyTimeEntry).toHaveBeenCalledWith(7, 'No work occurred', 17),
  )
})
it('does not offer keep-original for hand-added time even with a snapshot', () => {
  const config = changedClockProps()
  config.entry.entry_method = 'manual'
  render(<ReviewSheet {...config} />)
  expect(
    screen.queryByRole('button', { name: 'Keep the original time' }),
  ).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Approve time' })).toBeEnabled()
})

it('hides keep-original when the server marks the original nonrestorable', () => {
  const config = changedClockProps()
  config.entry.overtime_status = 'pending'
  config.entry.pending_overtime_hours = 2
  config.entry.original_employee_change = { ...config.entry.original_employee_change!, restorable: false, restoration_reason: 'Original clock-out missing' }
  render(<ReviewSheet {...config} />)
  expect(screen.queryByRole('button', { name: 'Keep the original time' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Approve the change' })).toBeInTheDocument()
  expect(screen.getByText("The original clock-out was missing, so there's no original time to keep.")).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Approve time \+/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Deny overtime…' })).not.toBeInTheDocument()
})

it.each([true, false])('keeps the original-time reason in place on stale refusal (still pending: %s)', async (pending) => {
  const config = changedClockProps()
  const fresh = { ...config.entry, version: 18, original_employee_change: pending ? config.entry.original_employee_change : null }
  vi.mocked(api.rejectTimeEntryChange).mockResolvedValue({ status: 409, code: 'stale_entry', error: 'Changed' })
  vi.mocked(api.getTimeEntry).mockResolvedValue({ data: { time_entry: fresh } })
  vi.mocked(approvalsApi.pending).mockResolvedValue({ data: { pending_entries: [fresh] } } as never)
  render(<ReviewSheet {...config} />)
  fireEvent.click(screen.getByRole('button', { name: 'Keep the original time' }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Preserve this note' } })
  fireEvent.click(screen.getByRole('button', { name: 'Keep the original time' }))
  await screen.findByText(/Your note is kept/)
  expect(screen.getByRole('textbox')).toHaveValue('Preserve this note')
  expect(config.onClose).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Keep the original time' }).hasAttribute('disabled')).toBe(!pending)
})
