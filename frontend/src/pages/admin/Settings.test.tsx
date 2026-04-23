import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Settings from './Settings'

const apiMock = vi.hoisted(() => ({
  getAdminTimeCategories: vi.fn(),
  getAdminAppSettings: vi.fn(),
  getAdminContactSettings: vi.fn(),
  updateAdminContactSettings: vi.fn(),
}))

vi.mock('../../lib/api', () => ({
  api: {
    getAdminTimeCategories: apiMock.getAdminTimeCategories,
    getAdminAppSettings: apiMock.getAdminAppSettings,
    getAdminContactSettings: apiMock.getAdminContactSettings,
    updateAdminContactSettings: apiMock.updateAdminContactSettings,
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

    apiMock.getAdminTimeCategories.mockResolvedValue({
      data: { time_categories: [] },
    })
    apiMock.getAdminAppSettings.mockResolvedValue({
      data: {
        settings: {
          overtime_daily_threshold_hours: '8',
          overtime_weekly_threshold_hours: '40',
          early_clock_in_buffer_minutes: '5',
        },
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
  })

  it('loads and updates contact settings', async () => {
    render(<Settings />)

    expect(await screen.findByDisplayValue('ops@example.com')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByLabelText('Public inquiry topics')).toHaveValue('Aerial Tours\nGeneral Inquiry')
    })

    fireEvent.change(screen.getByLabelText('Notification recipient emails'), {
      target: { value: 'ops@example.com\nowner@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Public inquiry topics'), {
      target: { value: 'Aerial Tours\nVideo Packages' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save contact settings' }))

    await waitFor(() => {
      expect(apiMock.updateAdminContactSettings).toHaveBeenCalledWith({
        contact_notification_emails: ['ops@example.com', 'owner@example.com'],
        inquiry_topics: ['Aerial Tours', 'Video Packages'],
      })
    })

    expect(await screen.findByText('Contact inquiry settings updated')).toBeInTheDocument()
  })
})
