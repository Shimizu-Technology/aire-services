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
  autocompleteAdminClockLocation: vi.fn(),
  getAdminClockPlaceDetails: vi.fn(),
}))

vi.mock('../../lib/api', () => ({
  api: {
    getAdminTimeCategories: apiMock.getAdminTimeCategories,
    getAdminAppSettings: apiMock.getAdminAppSettings,
    getAdminContactSettings: apiMock.getAdminContactSettings,
    updateAdminContactSettings: apiMock.updateAdminContactSettings,
    geocodeAdminClockLocation: apiMock.geocodeAdminClockLocation,
    autocompleteAdminClockLocation: apiMock.autocompleteAdminClockLocation,
    getAdminClockPlaceDetails: apiMock.getAdminClockPlaceDetails,
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
    apiMock.autocompleteAdminClockLocation.mockReset()
    apiMock.getAdminClockPlaceDetails.mockReset()

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
    apiMock.autocompleteAdminClockLocation.mockResolvedValue({
      data: {
        suggestions: [
          {
            place_id: 'places/aire',
            description: 'AIRE Services Guam, Barrigada, Guam',
            main_text: 'AIRE Services Guam',
            secondary_text: 'Barrigada, Guam',
          },
        ],
      },
    })
    apiMock.getAdminClockPlaceDetails.mockResolvedValue({
      data: {
        place: {
          place_id: 'places/aire',
          display_name: 'AIRE Services Guam',
          formatted_address: '1780 Admiral Sherman Boulevard, Barrigada, Guam 96913',
          latitude: '13.469130',
          longitude: '144.799010',
        },
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

  it('can choose an address suggestion and apply its coordinates', async () => {
    render(<Settings />)

    fireEvent.change(await screen.findByPlaceholderText('Start typing AIRE, Admiral Sherman, Tiyan, or a Guam address'), {
      target: { value: 'AIRE Guam' },
    })

    expect(await screen.findByText('AIRE Services Guam')).toBeInTheDocument()
    expect(screen.getByText('Barrigada, Guam')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /AIRE Services Guam/i }))

    await waitFor(() => {
      expect(apiMock.getAdminClockPlaceDetails).toHaveBeenCalledWith('places/aire', expect.any(String))
      expect(screen.getByDisplayValue('13.469130')).toBeInTheDocument()
      expect(screen.getByDisplayValue('144.799010')).toBeInTheDocument()
    })
  })
})
