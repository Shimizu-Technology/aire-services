import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import EditTimeEntryModal from './EditTimeEntryModal'

const apiMock = vi.hoisted(() => ({
  updateTimeEntry: vi.fn(),
  deleteTimeEntry: vi.fn(),
}))

vi.mock('../../lib/api', () => ({
  api: apiMock,
}))

describe('EditTimeEntryModal', () => {
  afterEach(() => vi.restoreAllMocks())
  beforeEach(() => {
    apiMock.updateTimeEntry.mockReset()
    apiMock.deleteTimeEntry.mockReset()
    apiMock.updateTimeEntry.mockResolvedValue({ data: { time_entry: {} } })
  })

  it('normalizes existing ISO break timestamps into Guam HH:mm time inputs', () => {
    render(
      <EditTimeEntryModal
        isOpen
        entry={{
          id: 1,
          work_date: '2026-05-05',
          start_time: '09:00',
          end_time: '17:00',
          break_minutes: 30,
          description: null,
          entry_method: 'manual',
          status: 'completed',
          user: { id: 1, email: 'alice@example.com', full_name: 'Alice Pilot' },
          time_category: { id: 1, name: 'CFI' },
          breaks: [
            {
              id: 10,
              start_time: '2026-05-05T02:00:00.000Z',
              end_time: '2026-05-05T02:30:00.000Z',
              duration_minutes: 30,
            },
          ],
        }}
        categories={[{ id: 1, name: 'CFI' }]}
        canDelete
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onDeleted={vi.fn()}
      />,
    )

    const timeInputs = screen.getAllByDisplayValue(/^(09:00|17:00|12:00|12:30)$/)
    expect(timeInputs.map((input) => (input as HTMLInputElement).value)).toEqual(
      expect.arrayContaining(['12:00', '12:30']),
    )
    expect(screen.getByText(/return this entry to the approval queue/i)).toBeInTheDocument()
  })

  it('does not submit an empty detailed breaks array for entries with only aggregate break minutes', async () => {
    const onSaved = vi.fn()

    render(
      <EditTimeEntryModal
        isOpen
        entry={{
          id: 2,
          work_date: '2026-05-05',
          start_time: '09:00',
          end_time: '17:00',
          break_minutes: 30,
          description: null,
          entry_method: 'manual',
          status: 'completed',
          user: { id: 1, email: 'alice@example.com', full_name: 'Alice Pilot' },
          time_category: { id: 1, name: 'CFI' },
          breaks: [],
        }}
        categories={[{ id: 1, name: 'CFI' }]}
        canDelete
        onClose={vi.fn()}
        onSaved={onSaved}
        onDeleted={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /update/i }))

    await waitFor(() => expect(apiMock.updateTimeEntry).toHaveBeenCalled())
    expect(apiMock.updateTimeEntry.mock.calls[0][1]).not.toHaveProperty('breaks')
    expect(apiMock.updateTimeEntry.mock.calls[0][1]).toMatchObject({ break_minutes: 30 })
  })

  it('collects and resubmits a correction reason for an entry already exported to payroll', async () => {
    const onSaved = vi.fn()
    apiMock.updateTimeEntry
      .mockResolvedValueOnce({
        error: 'A correction reason is required because this entry was already exported to payroll.',
        code: 'correction_reason_required',
        export_references: ['AIRE-PAYROLL-20260817-ABC12345'],
      })
      .mockResolvedValueOnce({ data: { time_entry: {} } })

    render(
      <EditTimeEntryModal
        isOpen
        entry={{
          id: 3,
          work_date: '2026-05-05',
          start_time: '09:00',
          end_time: '17:00',
          break_minutes: 30,
          description: null,
          entry_method: 'manual',
          status: 'completed',
          user: { id: 1, email: 'alice@example.com', full_name: 'Alice Pilot' },
          time_category: { id: 1, name: 'CFI' },
          breaks: [],
        }}
        categories={[{ id: 1, name: 'CFI' }]}
        canDelete
        onClose={vi.fn()}
        onSaved={onSaved}
        onDeleted={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /update/i }))

    const reason = await screen.findByLabelText(/correction reason/i)
    expect(screen.getByText(/AIRE-PAYROLL-20260817-ABC12345/)).toBeInTheDocument()
    fireEvent.change(reason, { target: { value: 'Employee confirmed the corrected clock-out time.' } })
    fireEvent.click(screen.getByRole('button', { name: /update/i }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(apiMock.updateTimeEntry).toHaveBeenLastCalledWith(
      3,
      expect.any(Object),
      'Employee confirmed the corrected clock-out time.',
    )
  })

  it('requires a work category before saving a legacy uncategorized entry', async () => {
    render(
      <EditTimeEntryModal
        isOpen
        entry={{
          id: 4,
          work_date: '2026-05-05',
          start_time: '09:00',
          end_time: '17:00',
          break_minutes: 30,
          description: null,
          entry_method: 'manual',
          status: 'completed',
          user: { id: 1, email: 'alice@example.com', full_name: 'Alice Pilot' },
          time_category: null,
          breaks: [],
        }}
        categories={[]}
        canDelete
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onDeleted={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /update/i }))

    expect(screen.getByText(/assign an active work category to this person/i)).toBeInTheDocument()
    expect(apiMock.updateTimeEntry).not.toHaveBeenCalled()
  })

  it('preserves an unselected category until the operator explicitly chooses it', async () => {
    render(
      <EditTimeEntryModal
        isOpen
        entry={{
          id: 5,
          work_date: '2026-05-05',
          start_time: '09:00',
          end_time: '17:00',
          break_minutes: 30,
          description: null,
          entry_method: 'manual',
          status: 'completed',
          user: { id: 1, email: 'alice@example.com', full_name: 'Alice Pilot' },
          time_category: null,
          breaks: [],
        }}
        categories={[{ id: 1, name: 'CFI' }]}
        canDelete
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onDeleted={vi.fn()}
      />,
    )

    expect(screen.getByRole('combobox')).toHaveValue('')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: /update/i }))

    await waitFor(() => expect(apiMock.updateTimeEntry).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ time_category_id: 1 }),
      undefined,
    ))
  })

  const activeEntry = {
    id: 6, version: 3, work_date: '2026-11-01', start_time: '08:00', end_time: null,
    break_minutes: null, description: null, entry_method: 'clock' as const, status: 'clocked_in' as const,
    user: { id: 1, email: 'alice@example.com' }, time_category: null,
  }
  const renderReviewEditor = (entry = activeEntry, isAdmin = true) => render(
    <EditTimeEntryModal isOpen entry={entry} categories={[{ id: 1, name: 'CFI' }]} canDelete isAdmin={isAdmin}
      onClose={vi.fn()} onSaved={vi.fn()} onDeleted={vi.fn()} />,
  )

  it('keeps a missing category unselected during a notes-only active edit', async () => {
    renderReviewEditor()
    expect(screen.getByRole('combobox')).toHaveValue('')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Awaiting confirmation' } })
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    await waitFor(() => expect(apiMock.updateTimeEntry).toHaveBeenCalled())
    expect(apiMock.updateTimeEntry.mock.calls[0][1]).toMatchObject({ description: 'Awaiting confirmation' })
    expect(apiMock.updateTimeEntry.mock.calls[0][1].time_category_id).toBeUndefined()
    expect(apiMock.updateTimeEntry.mock.calls[0][1]).not.toHaveProperty('review_action')
    expect(apiMock.updateTimeEntry.mock.calls[0][1]).not.toHaveProperty('end_time')
  })

  it('requires an explicit stop time, category and reason for historical closure', async () => {
    renderReviewEditor()
    fireEvent.click(screen.getByRole('checkbox', { name: 'End this clock' }))
    const endInput = screen.getByLabelText('Clock-out time (Guam) *')
    expect(endInput).toHaveValue('')
    fireEvent.change(endInput, { target: { value: '12:00' } })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('Correction reason *'), { target: { value: 'Actual stop confirmed' } })
    fireEvent.click(screen.getByRole('button', { name: 'End clock and submit' }))
    await waitFor(() => expect(apiMock.updateTimeEntry).toHaveBeenCalledWith(6, {
      review_action: 'end_clock', expected_version: 3, stop_date: '2026-11-01', end_time: '12:00',
      time_category_id: 1, description: '',
    }, 'Actual stop confirmed'))
  })

  it('does not expose the admin clock transition to employees', () => {
    renderReviewEditor(activeEntry, false)
    expect(screen.queryByRole('checkbox', { name: 'End this clock' })).not.toBeInTheDocument()
  })

  it('submits denied time for review without changing the saved facts', async () => {
    render(<EditTimeEntryModal isOpen isAdmin entry={{ ...activeEntry, status: 'completed', entry_method: 'manual',
      end_time: '12:00', approval_status: 'denied', time_category: { id: 1, name: 'CFI' } }}
      categories={[{ id: 1, name: 'CFI' }]} canDelete onClose={vi.fn()} onSaved={vi.fn()} onDeleted={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('End Time *'), { target: { value: '18:00' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Submit denied time for review' }))
    expect(screen.getByLabelText('End Time *')).toHaveValue('12:00')
    expect(screen.getByLabelText('End Time *')).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Correction reason *'), { target: { value: 'Request separate review' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }))
    await waitFor(() => expect(apiMock.updateTimeEntry).toHaveBeenCalledWith(6,
      { review_action: 'resubmit_denied', expected_version: 3 }, 'Request separate review'))
  })


  it('renders a visible named dialog immediately outside a hidden transformed ancestor', () => {
    const host = document.createElement('div')
    host.style.opacity = '0'
    host.style.transform = 'translateY(20px)'
    document.body.append(host)
    render(<EditTimeEntryModal isOpen entry={activeEntry} categories={[]} canDelete isAdmin
      onClose={vi.fn()} onSaved={vi.fn()} onDeleted={vi.fn()} />, { container: host })
    const dialog = screen.getByRole('dialog', { name: 'Edit Time Entry' })
    expect(dialog).toBeVisible()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(host).not.toContainElement(dialog)
    expect(dialog.parentElement?.parentElement).toBe(document.body)
    expect(dialog.style.opacity).not.toBe('0')
    expect(dialog.parentElement?.style.opacity).not.toBe('0')
  })

  it('traps keyboard focus, closes with Escape and restores focus and scroll', () => {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 100, 30)] as unknown as DOMRectList)
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    const previousOverflow = document.body.style.overflow
    const onClose = vi.fn()
    const view = render(<EditTimeEntryModal isOpen entry={activeEntry} categories={[]} canDelete isAdmin
      onClose={onClose} onSaved={vi.fn()} onDeleted={vi.fn()} />)
    const first = screen.getByRole('link', { name: 'View complete activity history' })
    const last = screen.getByRole('button', { name: 'Update' })
    expect(first).toHaveFocus()
    expect(document.body.style.overflow).toBe('hidden')
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(first).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    view.unmount()
    expect(trigger).toHaveFocus()
    expect(document.body.style.overflow).toBe(previousOverflow)
    trigger.remove()
  })

})
