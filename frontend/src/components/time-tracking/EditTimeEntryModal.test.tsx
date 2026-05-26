import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import EditTimeEntryModal from './EditTimeEntryModal'

const apiMock = vi.hoisted(() => ({
  updateTimeEntry: vi.fn(),
  deleteTimeEntry: vi.fn(),
}))

vi.mock('../../lib/api', () => ({
  api: apiMock,
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: { children: ReactNode }) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

describe('EditTimeEntryModal break editing', () => {
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
          locked_at: null,
          user: { id: 1, email: 'alice@example.com', full_name: 'Alice Pilot' },
          time_category: null,
          breaks: [
            {
              id: 10,
              start_time: '2026-05-05T02:00:00.000Z',
              end_time: '2026-05-05T02:30:00.000Z',
              duration_minutes: 30,
            },
          ],
        }}
        categories={[]}
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
          locked_at: null,
          user: { id: 1, email: 'alice@example.com', full_name: 'Alice Pilot' },
          time_category: null,
          breaks: [],
        }}
        categories={[]}
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
})
