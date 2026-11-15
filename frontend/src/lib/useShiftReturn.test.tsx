import '@testing-library/jest-dom'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useShiftReturn } from './useShiftReturn'

const apiMock = vi.hoisted(() => ({ getTimeEntry: vi.fn() }))
vi.mock('./api', () => ({ api: apiMock }))

function Probe({ param }: { param?: string }) {
  const { state, finish } = useShiftReturn(param)
  const location = useLocation()
  return (
    <>
      <output data-testid="state">{state.status === 'ready' ? `ready:${state.entry.work_date}` : state.status}</output>
      <output data-testid="search">{location.search}</output>
      <button type="button" onClick={finish}>finish</button>
    </>
  )
}

const show = (url: string, param?: string) => render(<MemoryRouter initialEntries={[url]}><Probe param={param} /></MemoryRouter>)

describe('useShiftReturn', () => {
  beforeEach(() => apiMock.getTimeEntry.mockReset())
  afterEach(cleanup)

  it('does nothing without return=edit', () => {
    show('/admin/timecards?entry_id=7')
    expect(screen.getByTestId('state')).toHaveTextContent('idle')
    expect(apiMock.getTimeEntry).not.toHaveBeenCalled()
  })

  it("fetches the shift's current state, so a moved shift is found where it is now", async () => {
    apiMock.getTimeEntry.mockResolvedValue({ data: { time_entry: { id: 7, work_date: '2026-11-17', user: { id: 3 } } } })
    show('/admin/timecards?entry_id=7&return=edit&period=2026-11-01', 'entry_id')
    expect(screen.getByTestId('state')).toHaveTextContent('loading')
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('ready:2026-11-17'))
    expect(apiMock.getTimeEntry).toHaveBeenCalledWith(7)
  })

  it('reports a deleted or no-longer-editable shift', async () => {
    apiMock.getTimeEntry.mockResolvedValue({ error: 'Not found', status: 404 })
    show('/admin/timecards?entry_id=7&return=edit', 'entry_id')
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('gone'))
  })

  it('finish() removes only the return request', async () => {
    apiMock.getTimeEntry.mockResolvedValue({ data: { time_entry: { id: 7, work_date: '2026-11-17', user: { id: 3 } } } })
    show('/admin/timecards?user_id=3&entry_id=7&return=edit', 'entry_id')
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('ready'))
    screen.getByText('finish').click()
    await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent('?user_id=3&entry_id=7'))
    expect(screen.getByTestId('state')).toHaveTextContent('idle')
  })
})
