import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TimeEntry } from '../../lib/api'
import { FixClockOutForm } from './FixClockOutForm'

const apiMock = vi.hoisted(() => ({ updateTimeEntry: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: apiMock }))

const categories = [{ id: 3, name: 'Ground Operations' }, { id: 4, name: 'Maintenance' }]

function openEntry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 55, version: 4, work_date: '2026-11-10', start_time: '22:30', end_time: null, formatted_start_time: '10:30 PM', formatted_end_time: null,
    hours: 0, break_minutes: 0, description: null, entry_method: 'clock', clock_source: 'kiosk', status: 'clocked_in', admin_override: false,
    attendance_status: null, approval_status: null, overtime_status: 'none', clock_in_at: '2026-11-10T22:30:00.000000+10:00', clock_out_at: null,
    approved_by: null, approved_at: null, approval_note: null, overtime_approved_by: null, overtime_approved_at: null, overtime_note: null,
    schedule: null, breaks: [], time_category: { id: 3, name: 'Ground Operations' },
    user: { id: 7, email: 'caleb@example.test', display_name: 'Caleb', full_name: 'Caleb Perez', time_category_ids: [3, 4] },
    created_at: '2026-11-10T22:30:00+10:00', updated_at: '2026-11-10T22:30:00+10:00',
    ...overrides,
  }
}

function renderForm(entry = openEntry(), withCategories = categories) {
  const onSaved = vi.fn()
  const onCancel = vi.fn()
  const onReload = vi.fn()
  const view = render(<FixClockOutForm entry={entry} categories={withCategories} onSaved={onSaved} onCancel={onCancel} onReload={onReload} />)
  return { onSaved, onCancel, onReload, view }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-12T09:00:00+10:00'))
  apiMock.updateTimeEntry.mockReset().mockResolvedValue({ data: { time_entry: openEntry({ status: 'completed' }) } })
})
afterEach(() => vi.useRealTimers())

describe('FixClockOutForm', () => {
  it('focuses Clocked out and shows the overnight total and day before saving', () => {
    renderForm()
    const clockedOut = screen.getByLabelText(/Clocked out/)
    expect(clockedOut).toHaveFocus()
    fireEvent.change(clockedOut, { target: { value: '06:30' } })
    expect(screen.getByText('Next day, Wed, Nov 11')).toBeInTheDocument()
    expect(screen.getByText('Total 8.0h.')).toBeInTheDocument()
    expect(screen.getByText(/Goes back to Approvals as a corrected clock-out/)).toBeInTheDocument()
  })

  it('requires a reason and saves nothing without one', async () => {
    const { onSaved } = renderForm()
    fireEvent.change(screen.getByLabelText(/Clocked out/), { target: { value: '06:30' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save clock-out' })) })
    expect(screen.getByText(/Say why the clock-out changed/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Why the change/)).toHaveAttribute('aria-invalid', 'true')
    expect(apiMock.updateTimeEntry).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/Why the change/), { target: { value: '   ' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save clock-out' })) })
    expect(apiMock.updateTimeEntry).not.toHaveBeenCalled()
  })

  it('saves a 10:30 PM to 6:30 AM shift on the next morning, as a corrected clock-out', async () => {
    const { onSaved } = renderForm()
    fireEvent.change(screen.getByLabelText(/Clocked out/), { target: { value: '06:30' } })
    fireEvent.change(screen.getByLabelText(/Why the change/), { target: { value: 'Forgot to clock out, confirmed with Caleb' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save clock-out' })) })

    expect(apiMock.updateTimeEntry).toHaveBeenCalledWith(55, {
      review_action: 'end_clock', expected_version: 4, stop_date: '2026-11-11', end_time: '06:30', time_category_id: 3,
    }, 'Corrected clock-out: Forgot to clock out, confirmed with Caleb')
    expect(onSaved).toHaveBeenCalled()
  })

  it('keeps the shift on its own day when the clock-out is later the same day', async () => {
    renderForm(openEntry({ start_time: '07:02', formatted_start_time: '7:02 AM', clock_in_at: '2026-11-10T07:02:00+10:00' }))
    fireEvent.change(screen.getByLabelText(/Clocked out/), { target: { value: '15:30' } })
    expect(screen.queryByText(/Next day/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Why the change/), { target: { value: 'Corrected clock-out per Caleb' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save clock-out' })) })
    expect(apiMock.updateTimeEntry).toHaveBeenCalledWith(55, expect.objectContaining({ stop_date: '2026-11-10', end_time: '15:30' }), 'Corrected clock-out per Caleb')
  })

  it('asks for the work when the shift has no category it can keep', async () => {
    renderForm(openEntry({ time_category: null }))
    fireEvent.change(screen.getByLabelText(/Clocked out/), { target: { value: '06:30' } })
    fireEvent.change(screen.getByLabelText(/Why the change/), { target: { value: 'Forgot' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save clock-out' })) })
    expect(screen.getByText('Choose the work this shift was.')).toBeInTheDocument()
    expect(apiMock.updateTimeEntry).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(/^Work/), { target: { value: '4' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save clock-out' })) })
    expect(apiMock.updateTimeEntry).toHaveBeenCalledWith(55, expect.objectContaining({ time_category_id: 4 }), 'Corrected clock-out: Forgot')
  })

  it('says nothing was saved when the shift changed underneath, and offers a reload', async () => {
    apiMock.updateTimeEntry.mockResolvedValue({ error: 'This entry changed. Reload it before submitting the correction', status: 409, code: 'stale_entry' })
    const { onSaved, onReload } = renderForm()
    fireEvent.change(screen.getByLabelText(/Clocked out/), { target: { value: '06:30' } })
    fireEvent.change(screen.getByLabelText(/Why the change/), { target: { value: 'Forgot' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save clock-out' })) })
    expect(screen.getByRole('alert')).toHaveTextContent('This shift changed since you opened it. Nothing was saved.')
    expect(onSaved).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Reload this shift' }))
    expect(onReload).toHaveBeenCalled()
  })

  it('keeps the shift’s category when the categories arrive after the form opens', async () => {
    const { view } = renderForm(openEntry(), [])
    expect(screen.getByLabelText(/^Work/)).toBeInTheDocument()
    view.rerender(<FixClockOutForm entry={openEntry()} categories={categories} onSaved={vi.fn()} onCancel={vi.fn()} onReload={vi.fn()} />)
    expect(screen.queryByLabelText(/^Work/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Clocked out/), { target: { value: '06:30' } })
    fireEvent.change(screen.getByLabelText(/Why the change/), { target: { value: 'Forgot' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save clock-out' })) })
    expect(apiMock.updateTimeEntry).toHaveBeenCalledWith(55, expect.objectContaining({ time_category_id: 3 }), 'Corrected clock-out: Forgot')
  })

  it('refuses a clock-out in the future before asking the API', async () => {
    renderForm(openEntry({ work_date: '2026-11-12', clock_in_at: '2026-11-12T07:00:00+10:00', start_time: '07:00', formatted_start_time: '7:00 AM' }))
    fireEvent.change(screen.getByLabelText(/Clocked out/), { target: { value: '15:00' } })
    fireEvent.change(screen.getByLabelText(/Why the change/), { target: { value: 'Forgot' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save clock-out' })) })
    expect(screen.getByText(/in the future/)).toBeInTheDocument()
    expect(apiMock.updateTimeEntry).not.toHaveBeenCalled()
  })
})
