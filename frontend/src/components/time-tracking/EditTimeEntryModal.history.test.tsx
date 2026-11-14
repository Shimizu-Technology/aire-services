import '@testing-library/jest-dom'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom'
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
  const onClose = vi.fn()
  render(
    <EditTimeEntryModal
      isOpen
      entry={overrides.entry ?? entry}
      categories={overrides.categories ?? [{ id: 1, name: 'CFI' }, { id: 2, name: 'Maintenance' }]}
      canDelete
      canManageTeamTime
      onClose={onClose}
      onSaved={onSaved}
      onDeleted={vi.fn()}
    />,
  )
  return { onSaved, onClose }
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
    expect(href.searchParams.get('return_to')).toBe('/admin/timecards?user_id=7&period=2026-11-01&entry_id=44&return=edit')
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

describe('Edit shift: every way out asks first while edits are unsaved (M2)', () => {
  afterEach(cleanup)
  const edit = () => fireEvent.change(screen.getByLabelText(/End Time/), { target: { value: '15:00' } })
  const backdrop = () => screen.getByRole('dialog').parentElement as HTMLElement

  it.each([
    ['Cancel', () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))],
    ['Escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
    ['the backdrop', () => fireEvent.click(backdrop())],
  ])('closes a clean sheet at once with %s', (_name, exit) => {
    const { onClose } = show()
    exit()
    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it.each([
    ['Cancel', () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))],
    ['Escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
    ['the backdrop', () => fireEvent.click(backdrop())],
  ])('asks "Discard your changes?" for %s, and Keep editing keeps the edit', (_name, exit) => {
    const { onClose } = show()
    edit()
    exit()
    expect(onClose).not.toHaveBeenCalled()
    const prompt = screen.getByRole('alertdialog', { name: 'Discard your changes?' })
    fireEvent.click(within(prompt).getByRole('button', { name: 'Keep editing' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/End Time/)).toHaveValue('15:00')
  })

  it('closes only after Discard changes', () => {
    const { onClose } = show()
    edit()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('treats a note, a category change or a break as an edit too', () => {
    const { onClose } = show()
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Late' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('alertdialog', { name: 'Discard your changes?' })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not close while a save is running', async () => {
    let finish: (value: unknown) => void = () => undefined
    apiMock.updateTimeEntry.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const { onClose } = show()
    edit()
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    finish({ data: { time_entry: {} } })
  })

  it('warns before the tab closes or reloads only while dirty', () => {
    show()
    const closing = () => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }
    expect(closing()).toBe(false)
    edit()
    expect(closing()).toBe(true)
  })

  it('stays quiet when it deliberately moves to history', () => {
    Object.defineProperty(window, 'location', { configurable: true, value: { pathname: '/admin/timecards', search: '', assign: vi.fn() } })
    show()
    edit()
    fireEvent.click(historyLink())
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
  })

  it('asks before an in-app route change or browser Back, and a clean sheet does not', () => {
    const router = createMemoryRouter([
      { path: '/', element: <><Link to="/away">Away</Link><Sheet /></> },
      { path: '/away', element: <p>Away page</p> },
    ])
    function Sheet() {
      return <EditTimeEntryModal isOpen entry={entry} categories={[{ id: 1, name: 'CFI' }]} canDelete canManageTeamTime onClose={vi.fn()} onSaved={vi.fn()} onDeleted={vi.fn()} />
    }
    render(<RouterProvider router={router} />)
    fireEvent.click(screen.getByText('Away'))
    expect(screen.getByText('Away page')).toBeInTheDocument()
    cleanup()
    router.navigate('/')
    render(<RouterProvider router={router} />)
    edit()
    fireEvent.click(screen.getByText('Away'))
    const prompt = screen.getByRole('alertdialog', { name: 'Discard your changes?' })
    expect(screen.queryByText('Away page')).toBeNull()
    fireEvent.click(within(prompt).getByRole('button', { name: 'Keep editing' }))
    expect(screen.queryByText('Away page')).toBeNull()
    fireEvent.click(screen.getByText('Away'))
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(screen.getByText('Away page')).toBeInTheDocument()
  })

  it('asks before a query-only change such as browser Back from ?user_id (Timecards), and Discard closes the sheet', async () => {
    const onClose = vi.fn()
    function Sheet() {
      return <EditTimeEntryModal isOpen entry={entry} categories={[{ id: 1, name: 'CFI' }]} canDelete canManageTeamTime onClose={onClose} onSaved={vi.fn()} onDeleted={vi.fn()} />
    }
    const router = createMemoryRouter(
      [{ path: '/admin/timecards', element: <><Link to="/admin/timecards?user_id=9">Other person</Link><Sheet /></> }],
      { initialEntries: ['/admin/timecards', '/admin/timecards?user_id=7'], initialIndex: 1 },
    )
    render(<RouterProvider router={router} />)
    edit()
    await act(async () => { await router.navigate(-1) })
    const prompt = screen.getByRole('alertdialog', { name: 'Discard your changes?' })
    expect(router.state.location.search).toBe('?user_id=7')
    fireEvent.click(within(prompt).getByRole('button', { name: 'Keep editing' }))
    expect(router.state.location.search).toBe('?user_id=7')
    expect(screen.getByLabelText(/End Time/)).toHaveValue('15:00')
    // A changed query (selecting someone else) asks too.
    fireEvent.click(screen.getByText('Other person'))
    expect(screen.getByRole('alertdialog', { name: 'Discard your changes?' })).toBeInTheDocument()
    expect(router.state.location.search).toBe('?user_id=7')
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    await act(async () => { await router.navigate('/admin/timecards?user_id=7#top') })
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    await waitFor(() => expect(router.state.location.hash).toBe('#top'))
    expect(onClose).toHaveBeenCalled()
  })

  it('does not ask on a query-only change while the sheet is clean', async () => {
    const router = createMemoryRouter(
      [{ path: '/admin/timecards', element: <><Link to="/admin/timecards?user_id=9">Other person</Link><EditTimeEntryModal isOpen entry={entry} categories={[{ id: 1, name: 'CFI' }]} canDelete canManageTeamTime onClose={vi.fn()} onSaved={vi.fn()} onDeleted={vi.fn()} /></> }],
      { initialEntries: ['/admin/timecards?user_id=7'] },
    )
    render(<RouterProvider router={router} />)
    fireEvent.click(screen.getByText('Other person'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(router.state.location.search).toBe('?user_id=9')
  })
})

describe('Edit shift: a refused save is shown where it can be fixed (item 5)', () => {
  const scrollIntoView = vi.fn()
  const refusal = { error: 'This shift is in an exported period. Add a correction reason.', code: 'correction_reason_required', export_references: ['AIRE-PAY-1'] }
  beforeEach(() => {
    apiMock.updateTimeEntry.mockReset()
    apiMock.deleteTimeEntry.mockReset()
    scrollIntoView.mockClear()
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    Object.defineProperty(window, 'location', { configurable: true, value: { pathname: '/admin/timecards', search: '', assign: vi.fn() } })
  })
  afterEach(() => {
    cleanup()
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
  })
  const edit = () => fireEvent.change(screen.getByLabelText(/End Time/), { target: { value: '15:00' } })
  const reason = () => document.getElementById('time-entry-correction-reason') as HTMLTextAreaElement

  it('scrolls to the reason, focuses it and puts the error beside it', async () => {
    apiMock.updateTimeEntry.mockResolvedValue(refusal)
    show()
    edit()
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    await waitFor(() => expect(reason()).toBeInTheDocument())
    await waitFor(() => expect(reason()).toHaveFocus())
    expect(scrollIntoView.mock.contexts.some((node) => node === reason())).toBe(true)
    expect(reason()).toHaveAttribute('aria-invalid', 'true')
    expect(reason()).toHaveAccessibleDescription(/Correction reason: This shift is in an exported period\. Add a correction reason\./)
    expect(screen.getByText(/Correction reason: This shift is in an exported period/)).toBeVisible()
    expect(screen.getByText(/AIRE-PAY-1/)).toBeInTheDocument()
  })

  it('does the same from Save and view history, and does not leave the page', async () => {
    apiMock.updateTimeEntry.mockResolvedValue(refusal)
    show()
    edit()
    fireEvent.click(historyLink())
    fireEvent.click(screen.getByRole('button', { name: 'Save and view history' }))
    await waitFor(() => expect(reason()).toHaveFocus())
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(window.location.assign).not.toHaveBeenCalled()
    expect(reason()).toHaveAttribute('aria-invalid', 'true')
  })

  it('asks again without sending anything while the reason is still empty, then saves with it', async () => {
    apiMock.updateTimeEntry.mockResolvedValueOnce(refusal).mockResolvedValueOnce({ data: { time_entry: {} } })
    const { onSaved } = show()
    edit()
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    await waitFor(() => expect(reason()).toHaveFocus())
    apiMock.updateTimeEntry.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    expect(apiMock.updateTimeEntry).not.toHaveBeenCalled()
    expect(reason()).toHaveAccessibleDescription(/Explain what changed and why/)
    fireEvent.change(reason(), { target: { value: 'Paper timesheet shows 3:00 PM' } })
    expect(reason()).not.toHaveAttribute('aria-invalid')
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(apiMock.updateTimeEntry).toHaveBeenCalledWith(44, { end_time: '15:00' }, 'Paper timesheet shows 3:00 PM')
  })

  it('shows an overlapping-shift refusal beside the start and end times and focuses them', async () => {
    apiMock.updateTimeEntry.mockResolvedValue({ error: 'This overlaps Daniel Cruz\'s 7:00 AM shift.', code: 'overlapping_shift' })
    show()
    edit()
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    const start = screen.getByLabelText(/Start Time/)
    await waitFor(() => expect(start).toHaveFocus())
    expect(start).toHaveAttribute('aria-invalid', 'true')
    expect(start).toHaveAccessibleDescription(/Start and end time: This overlaps Daniel Cruz's 7:00 AM shift\./)
    expect(screen.getByLabelText(/End Time/)).toHaveAttribute('aria-invalid', 'true')
    fireEvent.change(start, { target: { value: '08:00' } })
    expect(start).not.toHaveAttribute('aria-invalid')
  })

  it('does the same when a delete is refused for want of a reason', async () => {
    apiMock.deleteTimeEntry.mockResolvedValue(refusal)
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete entry' }))
    await waitFor(() => expect(reason()).toHaveFocus())
    expect(reason()).toHaveAttribute('aria-invalid', 'true')
  })

  it('brings any other refusal into view in the sheet', async () => {
    apiMock.updateTimeEntry.mockResolvedValue({ error: 'The pay period is locked' })
    show()
    edit()
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The pay period is locked')
    expect(scrollIntoView.mock.contexts).toContain(alert)
  })
})
