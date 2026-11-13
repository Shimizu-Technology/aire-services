import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockMatchMedia } from '../../test/matchMedia'
import { LogMissedTimeSheet, type MissedTimePerson, type MissedTimePrefill } from './LogMissedTimeSheet'

const apiMock = vi.hoisted(() => ({ createTimeEntry: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: apiMock }))

// Roke is the signed-in manager; he is in the list but must never be picked for him.
const people: MissedTimePerson[] = [
  { id: 2, name: 'Roke Aguon', firstName: 'Roke', meta: 'Ops / Maintenance', timeCategoryIds: [3] },
  { id: 7, name: 'Caleb Perez', firstName: 'Caleb', meta: 'Ops / Maintenance', timeCategoryIds: [3] },
  { id: 9, name: 'Ethan Cruz', firstName: 'Ethan', meta: 'CFI', timeCategoryIds: [5, 6] },
]
const categories = [{ id: 3, name: 'Ground Operations' }, { id: 5, name: 'Flight Instruction' }, { id: 6, name: 'Ground School' }]

let restore: () => void
beforeEach(() => {
  restore = mockMatchMedia({ width: 390 })
  apiMock.createTimeEntry.mockReset().mockResolvedValue({ data: { time_entry: { id: 300 } } })
})
afterEach(() => restore())

function renderSheet(prefill: MissedTimePrefill) {
  const onSaved = vi.fn()
  render(<LogMissedTimeSheet open onClose={vi.fn()} people={people} categories={categories} prefill={prefill} today="2026-11-12" onSaved={onSaved} />)
  return { onSaved, dialog: screen.getByRole('dialog', { name: 'Log missed time' }) }
}

describe('LogMissedTimeSheet', () => {
  it('adds the shift for the person from the timecard, and names the result', async () => {
    const { onSaved, dialog } = renderSheet({ personId: 7, workDate: '2026-11-11' })
    expect(within(dialog).getByRole('button', { name: /Who worked/ })).toHaveTextContent('Caleb Perez')
    expect(within(dialog).getByText('Picked from the timecard you were on.')).toBeInTheDocument()
    expect(within(dialog).getByText(/It goes to Approvals as an added shift/)).toBeInTheDocument()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add 8.0h for Caleb' })) })

    expect(apiMock.createTimeEntry).toHaveBeenCalledWith({
      user_id: 7, work_date: '2026-11-11', start_time: '07:00', end_time: '15:30', break_minutes: 30, time_category_id: 3, description: undefined,
    })
    expect(onSaved).toHaveBeenCalledWith(people[1], 8)
  })

  it('never defaults to the viewer: with no timecard person, someone has to be chosen', async () => {
    const { dialog } = renderSheet({ personId: null, workDate: '2026-11-11' })
    expect(within(dialog).getByRole('button', { name: /Who worked/ })).toHaveTextContent('Choose a person')
    const save = screen.getByRole('button', { name: 'Add shift' })
    expect(save).toBeDisabled()
    expect(save).toHaveAttribute('title', 'Choose who worked first')
    await act(async () => { fireEvent.click(save) })
    expect(apiMock.createTimeEntry).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: /Who worked/ }))
    const picker = screen.getByRole('dialog', { name: 'Who worked' })
    fireEvent.click(within(picker).getByRole('button', { name: /Ethan Cruz/ }))
    fireEvent.change(screen.getByLabelText(/^Work/), { target: { value: '6' } })
    fireEvent.change(screen.getByLabelText(/^End/), { target: { value: '12:00' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add 4.5h for Ethan' })) })
    expect(apiMock.createTimeEntry).toHaveBeenCalledWith(expect.objectContaining({ user_id: 9, time_category_id: 6, end_time: '12:00' }))
  })

  it('ignores a prefilled person who isn’t in the list rather than guessing', () => {
    const { dialog } = renderSheet({ personId: 99 })
    expect(within(dialog).getByRole('button', { name: /Who worked/ })).toHaveTextContent('Choose a person')
  })

  it('needs a work category the person has', async () => {
    renderSheet({ personId: 9, workDate: '2026-11-11' })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add 8.0h for Ethan' })) })
    expect(screen.getByText('Choose the work.')).toBeInTheDocument()
    expect(apiMock.createTimeEntry).not.toHaveBeenCalled()
  })

  it('refuses a day that hasn’t happened yet', async () => {
    renderSheet({ personId: 7, workDate: '2026-11-13' })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add 8.0h for Caleb' })) })
    expect(screen.getByText("That day hasn't happened yet.")).toBeInTheDocument()
    expect(apiMock.createTimeEntry).not.toHaveBeenCalled()
  })

  it('says nothing was saved when the API refuses', async () => {
    apiMock.createTimeEntry.mockResolvedValue({ error: 'Choose an active work category assigned to this person' })
    const { onSaved } = renderSheet({ personId: 7, workDate: '2026-11-11' })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add 8.0h for Caleb' })) })
    expect(screen.getByRole('alert')).toHaveTextContent('Choose an active work category assigned to this person Nothing was saved.')
    expect(onSaved).not.toHaveBeenCalled()
  })
})
