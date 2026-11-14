import '@testing-library/jest-dom'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import WeekGrid, { type WeekGridEntry } from './WeekGrid'

const weekDates = ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']
const entry: WeekGridEntry = {
  id: 1,
  hours: 7.5,
  start_time: '08:00',
  formatted_start_time: '8:00 AM',
  formatted_end_time: '3:30 PM',
  approval_status: 'pending',
  time_category: { name: 'Ground Operations' },
  user: { id: 7 },
}

function renderGrid() {
  return render(
    <WeekGrid
      weekDates={weekDates}
      entriesByDate={{ '2026-11-09': [entry] }}
      hoursPerDay={{ '2026-11-09': 7.5 }}
      ownerLabel={() => 'Joaquin Mendiola'}
      openEditEntry={vi.fn()}
      setPersonDayModal={vi.fn()}
      openNewEntry={vi.fn()}
      addDisabled={false}
    />,
  )
}

function sizeScroller(scrollWidth: number, clientWidth: number) {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(scrollWidth)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(clientWidth)
}

describe('WeekGrid below 1280px (M4)', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('tells people the week scrolls sideways and keeps each day wide enough to read', () => {
    const { container } = renderGrid()
    expect(screen.getByText('Scroll sideways to see every day')).toBeInTheDocument()
    const canvases = container.querySelectorAll('.grid-cols-7')
    expect(canvases).toHaveLength(2)
    canvases.forEach((canvas) => {
      expect(canvas.className).toContain('min-w-[1020px]')
      expect(canvas.className).toContain('xl:min-w-full')
    })
    expect(screen.getByText('Ground Operations')).toBeInTheDocument()
    expect(screen.getByText('Joaquin Mendiola')).toBeInTheDocument()
  })

  it('shows a fade at the right edge while more days are hidden, and drops it at the end', () => {
    sizeScroller(1020, 740)
    const { container } = renderGrid()
    const fade = () => container.querySelector('.bg-linear-to-l')
    expect(fade()).not.toBeNull()
    const scroller = container.querySelector('.overflow-x-auto') as HTMLElement
    scroller.scrollLeft = 280
    fireEvent.scroll(scroller)
    expect(fade()).toBeNull()
  })

  it('shows no fade when the whole week fits', () => {
    sizeScroller(1040, 1040)
    const { container } = renderGrid()
    expect(container.querySelector('.bg-linear-to-l')).toBeNull()
  })
})
