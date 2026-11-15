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

  it('says "waiting" in words on a waiting shift, and the dot is only decoration', () => {
    const { container } = renderGrid()
    expect(screen.getByText('7.5h waiting')).toBeVisible()
    const dot = container.querySelector('.bg-amber-500')
    expect(dot).toHaveAttribute('aria-hidden', 'true')
    expect(dot).not.toHaveAttribute('title')
  })

  it('shows no waiting text on an approved shift', () => {
    render(
      <WeekGrid
        weekDates={weekDates}
        entriesByDate={{ '2026-11-09': [{ ...entry, approval_status: 'approved' }] }}
        hoursPerDay={{ '2026-11-09': 7.5 }}
        ownerLabel={() => 'Joaquin Mendiola'}
        openEditEntry={vi.fn()}
        setPersonDayModal={vi.fn()}
        openNewEntry={vi.fn()}
        addDisabled={false}
      />,
    )
    expect(screen.queryByText(/waiting/)).toBeNull()
  })

  it('adds up the waiting hours for a person with several shifts in one day', () => {
    render(
      <WeekGrid
        weekDates={weekDates}
        entriesByDate={{ '2026-11-09': [entry, { ...entry, id: 2, hours: 2.5 }, { ...entry, id: 3, hours: 4, approval_status: 'approved' }] }}
        hoursPerDay={{ '2026-11-09': 14 }}
        ownerLabel={() => 'Joaquin Mendiola'}
        openEditEntry={vi.fn()}
        setPersonDayModal={vi.fn()}
        openNewEntry={vi.fn()}
        addDisabled={false}
      />,
    )
    expect(screen.getByText('10h waiting')).toBeVisible()
  })

  it('names a denied shift in words too', () => {
    render(
      <WeekGrid
        weekDates={weekDates}
        entriesByDate={{ '2026-11-09': [{ ...entry, approval_status: 'denied' }] }}
        hoursPerDay={{ '2026-11-09': 0 }}
        ownerLabel={() => 'Joaquin Mendiola'}
        openEditEntry={vi.fn()}
        setPersonDayModal={vi.fn()}
        openNewEntry={vi.fn()}
        addDisabled={false}
      />,
    )
    expect(screen.getByText('Denied')).toBeVisible()
  })
})
