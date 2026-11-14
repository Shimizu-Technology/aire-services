import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
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
  },
}))
vi.mock('../../lib/api/approvals', () => ({ approvalsApi: { history: vi.fn() } }))
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
  vi.clearAllMocks()
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
  expect(api.denyTimeEntry).toHaveBeenCalledWith(7, 'Please correct this shift.')
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

it('closes stale denial instead of keeping obsolete review classification', async () => {
  vi.mocked(approvalsApi.history).mockResolvedValue({ data: { entry_id: 7, changes: [] } })
  vi.mocked(api.getTimeEntry).mockResolvedValue({
    data: { time_entry: reviewEntry(7, 1, { version: 18, description: 'New shift facts' }) },
  })
  const config = props()
  render(<ReviewSheet {...config} />)
  fireEvent.click(screen.getByRole('button', { name: 'Deny…' }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Stale note' } })
  fireEvent.click(screen.getByRole('button', { name: 'Deny shift' }))
  await waitFor(() =>
    expect(config.onClose).toHaveBeenCalledWith(
      true,
      'This shift changed since you opened it. Nothing was denied.',
    ),
  )
  expect(screen.queryByText('New shift facts')).not.toBeInTheDocument()
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

it('closes an unknown decision as Saved when Reload confirms its requested fields', async () => {
  vi.mocked(approvalsApi.history).mockResolvedValue({ data: { entry_id: 7, changes: [] } })
  const config = props()
  config.onApprove.mockResolvedValue('unknown')
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
      'This shift changed since you opened it. Nothing was approved.',
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
  expect(screen.getByText('Waiting')).toBeInTheDocument()
  expect(await screen.findByText(/8.0h · waiting/)).toBeInTheDocument()
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
