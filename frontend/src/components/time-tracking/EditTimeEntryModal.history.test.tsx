import '@testing-library/jest-dom'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import EditTimeEntryModal from './EditTimeEntryModal'

const apiMock = vi.hoisted(() => ({ updateTimeEntry: vi.fn(), deleteTimeEntry: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: apiMock }))

const entry = {
  id: 44,
  version: 2,
  hours: 8,
  work_date: '2026-11-14',
  start_time: '07:30',
  end_time: '15:30',
  break_minutes: 0,
  description: null,
  entry_method: 'manual' as const,
  status: 'completed' as const,
  approval_status: 'pending' as const,
  user: { id: 7, email: 'daniel@example.com', full_name: 'Daniel Cruz' },
  time_category: { id: 1, name: 'CFI' },
  breaks: [],
}

const originalLocation = window.location
const assign = vi.fn()

function show(overrides: Partial<{ categories: Array<{ id: number; name: string }>; entry: typeof entry | (Omit<typeof entry, 'time_category'> & { time_category: null }) }> = {}) {
  const onSaved = vi.fn()
  render(
    <EditTimeEntryModal
      isOpen
      entry={overrides.entry ?? entry}
      categories={overrides.categories ?? [{ id: 1, name: 'CFI' }, { id: 2, name: 'Maintenance' }]}
      canDelete
      canManageTeamTime
      onClose={vi.fn()}
      onSaved={onSaved}
      onDeleted={vi.fn()}
    />,
  )
  return { onSaved }
}

const historyLink = () => screen.getByRole('link', { name: 'View complete activity history' })

describe('Edit shift: field names (M3)', () => {
  beforeEach(() => apiMock.updateTimeEntry.mockReset())
  afterEach(cleanup)

  it('gives the date input and work select the names people see', () => {
    show()
    expect(screen.getByLabelText(/Work date/)).toHaveAttribute('type', 'date')
    expect(screen.getByRole('combobox', { name: 'Kind of work' })).toHaveValue('1')
  })

  it('links the missing-work hint to the select', () => {
    show({ categories: [] })
    const select = screen.getByRole('combobox', { name: 'Kind of work' })
    expect(select).toHaveAccessibleDescription('Assign an active work category to this person before saving.')
  })

  it('names the field in its error, marks it invalid, links the message and focuses it', async () => {
    show({ entry: { ...entry, time_category: null } })
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    const select = screen.getByRole('combobox', { name: 'Kind of work' })
    expect(select).toHaveAttribute('aria-invalid', 'true')
    expect(select).toHaveAccessibleDescription('Kind of work: Choose the kind of work before saving this shift.')
    await waitFor(() => expect(select).toHaveFocus())
    expect(apiMock.updateTimeEntry).not.toHaveBeenCalled()
    fireEvent.change(select, { target: { value: '2' } })
    expect(select).not.toHaveAttribute('aria-invalid')
  })
})

describe('Edit shift: viewing history with unsaved changes (M2)', () => {
  beforeEach(() => {
    apiMock.updateTimeEntry.mockReset()
    apiMock.updateTimeEntry.mockResolvedValue({ data: { time_entry: {} } })
    assign.mockReset()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { pathname: '/admin/timecards', search: '?user_id=7&period=2026-11-01', assign },
    })
  })
  afterEach(() => {
    cleanup()
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
  })

  it('goes straight to history when nothing has changed', () => {
    show()
    expect(fireEvent.click(historyLink())).toBe(true)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('points history back at the same person, period and shift', () => {
    show()
    const href = new URL(historyLink().getAttribute('href')!, 'https://local.invalid')
    expect(href.pathname).toBe('/admin/activity')
    expect(href.searchParams.get('subject_id')).toBe('44')
    expect(href.searchParams.get('shift_person')).toBe('Daniel Cruz')
    expect(href.searchParams.get('return_to')).toBe('/admin/timecards?user_id=7&period=2026-11-01&entry_id=44')
  })

  it('asks before leaving, and Keep editing keeps every edit', () => {
    show()
    fireEvent.change(screen.getByLabelText(/End Time/), { target: { value: '15:00' } })
    expect(fireEvent.click(historyLink())).toBe(false)
    const dialog = screen.getByRole('alertdialog', { name: 'Save your changes before viewing history?' })
    expect(within(dialog).getByRole('button', { name: 'Save and view history' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Discard changes' })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByLabelText(/End Time/)).toHaveValue('15:00')
    expect(assign).not.toHaveBeenCalled()
  })

  it('treats Escape as Keep editing', () => {
    show()
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Note' } })
    fireEvent.click(historyLink())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByLabelText('Description')).toHaveValue('Note')
  })

  it('saves first, then opens history', async () => {
    const { onSaved } = show()
    fireEvent.change(screen.getByLabelText(/End Time/), { target: { value: '15:00' } })
    fireEvent.click(historyLink())
    fireEvent.click(screen.getByRole('button', { name: 'Save and view history' }))
    await waitFor(() => expect(assign).toHaveBeenCalledOnce())
    expect(apiMock.updateTimeEntry).toHaveBeenCalledWith(44, { end_time: '15:00' }, undefined)
    expect(onSaved).toHaveBeenCalled()
    expect(assign.mock.calls[0][0]).toContain('/admin/activity?subject_type=TimeEntry&subject_id=44')
  })

  it('stays on the sheet with the error when the save fails', async () => {
    apiMock.updateTimeEntry.mockResolvedValue({ error: 'The pay period is locked' })
    show()
    fireEvent.change(screen.getByLabelText(/End Time/), { target: { value: '15:00' } })
    fireEvent.click(historyLink())
    fireEvent.click(screen.getByRole('button', { name: 'Save and view history' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The pay period is locked')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(assign).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/End Time/)).toHaveValue('15:00')
  })

  it('discards only when asked', () => {
    show()
    fireEvent.change(screen.getByLabelText(/End Time/), { target: { value: '15:00' } })
    fireEvent.click(historyLink())
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(apiMock.updateTimeEntry).not.toHaveBeenCalled()
    expect(assign).toHaveBeenCalledWith(expect.stringContaining('/admin/activity?subject_type=TimeEntry&subject_id=44'))
  })

  it('lets a new-tab click through without a prompt', () => {
    show()
    fireEvent.change(screen.getByLabelText(/End Time/), { target: { value: '15:00' } })
    expect(fireEvent.click(historyLink(), { ctrlKey: true })).toBe(true)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})
