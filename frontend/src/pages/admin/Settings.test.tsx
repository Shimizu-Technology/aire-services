import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Settings from './Settings'

const apiMock = vi.hoisted(() => ({
  getAdminTimeCategories: vi.fn(),
  getAdminAppSettings: vi.fn(),
  getAdminContactSettings: vi.fn(),
  updateAdminContactSettings: vi.fn(),
  geocodeAdminClockLocation: vi.fn(),
}))

vi.mock('../../lib/api', () => ({
  api: {
    getAdminTimeCategories: apiMock.getAdminTimeCategories,
    getAdminAppSettings: apiMock.getAdminAppSettings,
    getAdminContactSettings: apiMock.getAdminContactSettings,
    updateAdminContactSettings: apiMock.updateAdminContactSettings,
    geocodeAdminClockLocation: apiMock.geocodeAdminClockLocation,
  },
}))

vi.mock('../../components/ui/MotionComponents', () => ({
  FadeUp: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

describe('Admin Settings contact settings', () => {
  beforeEach(() => {
    apiMock.getAdminTimeCategories.mockReset()
    apiMock.getAdminAppSettings.mockReset()
    apiMock.getAdminContactSettings.mockReset()
    apiMock.updateAdminContactSettings.mockReset()
    apiMock.geocodeAdminClockLocation.mockReset()

    apiMock.getAdminTimeCategories.mockResolvedValue({
      data: { time_categories: [] },
    })
    apiMock.getAdminAppSettings.mockResolvedValue({
      data: {
        settings: {
          overtime_daily_threshold_hours: '8',
          overtime_weekly_threshold_hours: '40',
          early_clock_in_buffer_minutes: '5',
          clock_in_location_enforced: 'true',
          clock_in_location_name: 'AIRE Services Guam',
          clock_in_location_latitude: '13.46913',
          clock_in_location_longitude: '144.79901',
          clock_in_location_radius_meters: '1000',
        },
        approval_groups: [
          { key: 'cfi', label: 'CFI' },
          { key: 'ops_maintenance', label: 'Ops / Maintenance' },
        ],
      },
    })
    apiMock.getAdminContactSettings.mockResolvedValue({
      data: {
        contact_notification_emails: ['ops@example.com'],
        inquiry_topics: ['Aerial Tours', 'General Inquiry'],
      },
    })
    apiMock.updateAdminContactSettings.mockResolvedValue({
      data: {
        contact_notification_emails: ['ops@example.com', 'owner@example.com'],
        inquiry_topics: ['Aerial Tours', 'Video Packages'],
        message: 'Contact inquiry settings updated',
      },
    })
    apiMock.geocodeAdminClockLocation.mockResolvedValue({
      data: {
        results: [
          {
            display_name: 'AIRE Services Guam, Barrigada, Guam',
            latitude: '13.469130',
            longitude: '144.799010',
          },
        ],
      },
    })
  })

  it('loads and updates contact settings', async () => {
    render(<Settings />)

    expect(await screen.findByDisplayValue('ops@example.com')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByLabelText('Public inquiry topics')).toHaveValue('Aerial Tours')
      expect(screen.getByLabelText('Public inquiry topic 2')).toHaveValue('General Inquiry')
    })

    fireEvent.change(screen.getByLabelText('Notification recipient emails'), {
      target: { value: 'ops@example.com\nowner@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Public inquiry topic 2'), { target: { value: 'Video Packages' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save contact settings' }))

    await waitFor(() => {
      expect(apiMock.updateAdminContactSettings).toHaveBeenCalledWith({
        contact_notification_emails: ['ops@example.com', 'owner@example.com'],
        inquiry_topics: ['Aerial Tours', 'Video Packages'],
      })
    })

    expect(await screen.findByText('Contact inquiry settings updated')).toBeInTheDocument()
  })

  it('can search by address and apply a geocoding result', async () => {
    render(<Settings />)

    fireEvent.change(await screen.findByPlaceholderText('1780 Admiral Sherman Boulevard, Barrigada, Guam'), {
      target: { value: 'AIRE Guam' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Find address' }))

    expect(await screen.findByText('AIRE Services Guam, Barrigada, Guam')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'AIRE Services Guam, Barrigada, Guam' }))

    await waitFor(() => {
      expect(screen.getByDisplayValue('13.469130')).toBeInTheDocument()
      expect(screen.getByDisplayValue('144.799010')).toBeInTheDocument()
    })
  })
})
