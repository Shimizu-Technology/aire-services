import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ClockInOutCard from './ClockInOutCard'

const apiMock = vi.hoisted(() => ({
  getClockStatus: vi.fn(),
  getTimeCategories: vi.fn(),
  clockIn: vi.fn(),
  startBreak: vi.fn(),
  endBreak: vi.fn(),
}))

vi.mock('../../lib/api', () => ({
  api: {
    getClockStatus: apiMock.getClockStatus,
    getTimeCategories: apiMock.getTimeCategories,
    clockIn: apiMock.clockIn,
    startBreak: apiMock.startBreak,
    endBreak: apiMock.endBreak,
  },
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: { children: ReactNode }) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

describe('ClockInOutCard geofence messaging', () => {
  beforeEach(() => {
    apiMock.getClockStatus.mockReset()
    apiMock.getTimeCategories.mockReset()
    apiMock.clockIn.mockReset()
    apiMock.startBreak.mockReset()
    apiMock.endBreak.mockReset()

    apiMock.getClockStatus.mockResolvedValue({
      data: {
        clocked_in: false,
        clock_in_at: null,
        clock_out_at: null,
        break_minutes: 0,
        active_break: false,
        active_break_started_at: null,
        breaks: [],
        session: null,
        schedule: null,
        can_clock_in: true,
        clock_in_blocked_reason: null,
        clock_in_location_required: true,
        clock_in_location_name: 'AIRE Services Guam',
        clock_in_location_radius_meters: 1000,
        is_admin: false,
        time_category: null,
      },
    })
    apiMock.getTimeCategories.mockResolvedValue({
      data: {
        time_categories: [],
      },
    })
  })

  it('shows the geolocation permission error instead of a generic failure', async () => {
    const getCurrentPosition = vi.fn((_success, error) => {
      error({
        code: 1,
        PERMISSION_DENIED: 1,
      })
    })

    Object.defineProperty(globalThis.navigator, 'geolocation', {
      value: {
        getCurrentPosition,
      },
      configurable: true,
    })

    render(<ClockInOutCard />)

    const button = (await screen.findAllByRole('button', { name: /clock in/i }))[0]
    fireEvent.click(button)

    expect((await screen.findAllByText('Location access is required before you can clock in.')).length).toBeGreaterThan(0)
    expect(apiMock.clockIn).not.toHaveBeenCalled()
  })
})
