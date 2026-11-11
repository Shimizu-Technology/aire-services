import type { ReactElement, ReactNode } from 'react'
import { fireEvent, render as renderUi, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Settings from './Settings'
import { defaultPublicContactSettings } from '../../lib/businessInfo'
import { defaultSocialLinks } from '../../lib/socialLinks'
import settingsCatalog from '../../test/fixtures/settings-catalog.json'

const stagingMock = vi.hoisted(() => ({ enabled: false }))
vi.mock('../../lib/staging', () => ({ get isStaging() { return stagingMock.enabled } }))

const apiMock = vi.hoisted(() => ({
  getAdminTimeCategories: vi.fn(),
  getAdminAppSettings: vi.fn(),
  getAdminContactSettings: vi.fn(),
  updateAdminContactSettings: vi.fn(),
  updateAdminAppSettings: vi.fn(),
  geocodeAdminClockLocation: vi.fn(),
  autocompleteAdminClockLocation: vi.fn(),
  getAdminClockPlaceDetails: vi.fn(),
  deleteTimeCategory: vi.fn(),
}))

const payStubsMock = vi.hoisted(() => ({ notificationEmails: vi.fn(), updateNotificationEmails: vi.fn() }))
vi.mock('../../lib/payStubsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/payStubsApi')>()
  return { ...actual, payStubsApi: payStubsMock }
})

vi.mock('../../lib/api', () => ({
  api: {
    getAdminTimeCategories: apiMock.getAdminTimeCategories,
    getAdminAppSettings: apiMock.getAdminAppSettings,
    getAdminContactSettings: apiMock.getAdminContactSettings,
    updateAdminContactSettings: apiMock.updateAdminContactSettings,
    updateAdminAppSettings: apiMock.updateAdminAppSettings,
    geocodeAdminClockLocation: apiMock.geocodeAdminClockLocation,
    autocompleteAdminClockLocation: apiMock.autocompleteAdminClockLocation,
    getAdminClockPlaceDetails: apiMock.getAdminClockPlaceDetails,
    deleteTimeCategory: apiMock.deleteTimeCategory,
  },
}))

vi.mock('../../components/ui/MotionComponents', () => ({
  FadeUp: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

// The page links to Roles & access and Website, so it renders inside a router.
const render = (ui: ReactElement) => renderUi(ui, { wrapper: MemoryRouter })

describe('Admin Settings contact settings', () => {
  beforeEach(() => {
    payStubsMock.notificationEmails.mockReset().mockResolvedValue({ emails: [], editable: true })
    payStubsMock.updateNotificationEmails.mockReset()
    stagingMock.enabled = false
    apiMock.getAdminTimeCategories.mockReset()
    apiMock.getAdminAppSettings.mockReset()
    apiMock.getAdminContactSettings.mockReset()
    apiMock.updateAdminContactSettings.mockReset()
    apiMock.updateAdminAppSettings.mockReset()
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
        catalog: settingsCatalog,
      },
    })
    apiMock.getAdminContactSettings.mockResolvedValue({
      data: {
        contact_notification_emails: ['ops@example.com'],
        inquiry_topics: ['Aerial Tours', 'General Inquiry'],
        public_contact: defaultPublicContactSettings,
        social_links: defaultSocialLinks,
      },
    })
    apiMock.updateAdminContactSettings.mockResolvedValue({
      data: {
        contact_notification_emails: ['ops@example.com', 'owner@example.com'],
        inquiry_topics: ['Aerial Tours', 'Video Packages'],
        public_contact: {
          ...defaultPublicContactSettings,
          phone_display: '(671) 555-0100',
        },
        social_links: [
          ...defaultSocialLinks,
          { key: 'tiktok', label: 'TikTok', url: 'https://www.tiktok.com/@aireservicesguam' },
        ],
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

  it('explains disabled staging maps and retains saved coordinates without an external preview', async () => {
    stagingMock.enabled = true
    render(<Settings />)
    expect(await screen.findByText(/Map previews are disabled in staging/)).toBeInTheDocument()
    expect(screen.getByText('13.46913')).toBeInTheDocument()
    expect(screen.getByText('144.79901')).toBeInTheDocument()
    expect(screen.queryByTitle('Clock-in location preview')).toBeNull()
    expect(screen.queryByText(/Search for an address or use your current location to preview/)).toBeNull()
  })

  it('loads and updates contact settings under Website', async () => {
    render(<Settings view="website" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Contact & links' })).toBeInTheDocument()

    expect(await screen.findByDisplayValue('ops@example.com')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByLabelText('Public inquiry topics')).toHaveValue('Aerial Tours')
      expect(screen.getByLabelText('Public inquiry topic 2')).toHaveValue('General Inquiry')
      expect(screen.getByLabelText('Street address')).toHaveValue('353 Admiral Sherman Boulevard')
    })

    fireEvent.change(screen.getByLabelText('Notification recipient emails'), {
      target: { value: 'ops@example.com\nowner@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Public inquiry topic 2'), { target: { value: 'Video Packages' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add social link' }))
    fireEvent.change(screen.getByLabelText('Label', { selector: '#social-link-label-2' }), { target: { value: 'TikTok' } })
    fireEvent.change(screen.getByLabelText('URL', { selector: '#social-link-url-2' }), { target: { value: 'https://www.tiktok.com/@aireservicesguam' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save contact settings' }))

    await waitFor(() => {
      expect(apiMock.updateAdminContactSettings).toHaveBeenCalledWith({
        contact_notification_emails: ['ops@example.com', 'owner@example.com'],
        inquiry_topics: ['Aerial Tours', 'Video Packages'],
        public_contact: defaultPublicContactSettings,
        social_links: [
          ...defaultSocialLinks,
          { key: 'tiktok', label: 'TikTok', url: 'https://www.tiktok.com/@aireservicesguam' },
        ],
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

  it('turns off managers approving their own time and shows the saved state', async () => {
    apiMock.updateAdminAppSettings.mockImplementation(async ({ settings }) => ({
      data: {
        settings: { clock_in_location_name: 'AIRE Services Guam', ...settings },
        approval_groups: [{ key: 'cfi', label: 'CFI' }],
      },
    }))
    render(<Settings />)

    const toggle = await screen.findByRole('checkbox', { name: 'Managers can approve their own time' })
    expect(toggle).toBeChecked()
    expect(toggle).toHaveAccessibleDescription(/another manager approves each manager's own time/)

    fireEvent.click(toggle)

    await waitFor(() => expect(apiMock.updateAdminAppSettings).toHaveBeenCalledWith({
      settings: { managers_can_approve_own_time: 'false' },
    }))
    expect(await screen.findByText("Managers' own time now goes to another approver.")).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Managers can approve their own time' })).not.toBeChecked()
  })

  it('does not let a slower time clock rules save restore an older switch value', async () => {
    let finishRulesSave: (value: unknown) => void = () => {}
    apiMock.updateAdminAppSettings.mockImplementation(({ settings }) => {
      if ('overtime_daily_threshold_hours' in settings) {
        // The rules response still carries the switch value from before the toggle.
        return new Promise((resolve) => {
          finishRulesSave = resolve
        }).then(() => ({
          data: { settings: { ...settings, managers_can_approve_own_time: 'true' }, approval_groups: [{ key: 'cfi', label: 'CFI' }] },
        }))
      }
      return Promise.resolve({ data: { settings: { ...settings }, approval_groups: [{ key: 'cfi', label: 'CFI' }] } })
    })
    render(<Settings />)

    const toggle = await screen.findByRole('checkbox', { name: 'Managers can approve their own time' })
    fireEvent.submit(screen.getByRole('button', { name: 'Save time clock rules' }).closest('form')!)
    fireEvent.click(toggle)
    expect(await screen.findByText("Managers' own time now goes to another approver.")).toBeInTheDocument()

    expect(apiMock.updateAdminAppSettings).toHaveBeenCalledWith({ settings: expect.objectContaining({ overtime_daily_threshold_hours: '8' }) })
    expect(screen.getByRole('button', { name: /Saving/ })).toBeDisabled()
    finishRulesSave(undefined)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save time clock rules' })).toBeEnabled())
    expect(screen.getByRole('checkbox', { name: 'Managers can approve their own time' })).not.toBeChecked()
  })

  it('scrolls to a linked section once settings have loaded', async () => {
    const scrollIntoView = vi.fn()
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scrollIntoView
    try {
    renderUi(<Settings />, { wrapper: ({ children }) => <MemoryRouter initialEntries={['/admin/settings#time-approvals']}>{children}</MemoryRouter> })

    await screen.findByRole('checkbox', { name: 'Managers can approve their own time' })
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    expect(scrollIntoView.mock.contexts[0]).toHaveProperty('id', 'time-approvals')
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })

  it('keeps the toggle unchanged and explains a failed save', async () => {
    apiMock.updateAdminAppSettings.mockResolvedValue({ error: 'Only owners and admins can change settings' })
    render(<Settings />)

    const toggle = await screen.findByRole('checkbox', { name: 'Managers can approve their own time' })
    fireEvent.click(toggle)

    expect(await screen.findByRole('alert')).toHaveTextContent('Only owners and admins can change settings')
    expect(screen.getByRole('checkbox', { name: 'Managers can approve their own time' })).toBeChecked()
  })

  it('keeps both pay stub switches off by default and turns one on', async () => {
    apiMock.updateAdminAppSettings.mockImplementation(async ({ settings }) => ({
      data: { settings: { clock_in_location_name: 'AIRE Services Guam', pay_stub_kiosk_requests_enabled: 'false', pay_stub_self_email_enabled: 'false', ...settings }, approval_groups: [] },
    }))
    render(<Settings />)

    const kiosk = await screen.findByRole('checkbox', { name: 'Pay stub requests at the kiosk' })
    const self = screen.getByRole('checkbox', { name: 'Workers can email themselves stubs' })
    expect(kiosk).not.toBeChecked()
    expect(self).not.toBeChecked()
    expect(self).toHaveAccessibleDescription(/only to the email on file/)

    fireEvent.click(kiosk)
    await waitFor(() => expect(apiMock.updateAdminAppSettings).toHaveBeenCalledWith({ settings: { pay_stub_kiosk_requests_enabled: 'true' } }))
    expect(await screen.findByText('Workers can now request pay stubs at the kiosk.')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Pay stub requests at the kiosk' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Workers can email themselves stubs' })).not.toBeChecked()
  })

  it('edits who gets a heads-up about kiosk requests', async () => {
    payStubsMock.updateNotificationEmails.mockResolvedValue({ emails: ['office@example.com'], editable: true })
    render(<Settings />)

    fireEvent.click(await screen.findByRole('button', { name: 'Change recipients' }))
    fireEvent.change(screen.getByLabelText('Email addresses, separated by commas'), { target: { value: 'office@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save recipients' }))

    await waitFor(() => expect(payStubsMock.updateNotificationEmails).toHaveBeenCalledWith('office@example.com'))
    expect(await screen.findByText(/New requests are also emailed to office@example.com/)).toBeInTheDocument()
  })

  describe('time category confirmations', () => {
    const category = (overrides: Record<string, unknown>) => ({
      id: 1, name: 'Ground School', key: 'ground', description: null, is_active: true,
      time_entries_count: 0, deletable: true, created_at: '2026-01-01', updated_at: '2026-01-01', ...overrides,
    })
    const showCategories = async (categories: unknown[]) => {
      apiMock.getAdminTimeCategories.mockResolvedValue({ data: { time_categories: categories } })
      apiMock.deleteTimeCategory.mockReset().mockResolvedValue({})
      render(<Settings />)
      await screen.findByText(categories.length > 1 ? 'Flight Instruction' : 'Ground School')
    }

    it('explains what deactivating a used category keeps, and does nothing on Cancel', async () => {
      await showCategories([category({ id: 7, name: 'Flight Instruction', time_entries_count: 12, deletable: false }), category({})])
      fireEvent.click(screen.getAllByRole('button', { name: 'Deactivate' })[0])
      const dialog = await screen.findByRole('alertdialog', { name: 'Deactivate "Flight Instruction"?' })
      expect(dialog).toHaveTextContent('Existing time entries keep this category; it will be hidden from new clock-ins.')
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
      expect(apiMock.deleteTimeCategory).not.toHaveBeenCalled()

      fireEvent.click(screen.getAllByRole('button', { name: 'Deactivate' })[0])
      fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Deactivate' }))
      await waitFor(() => expect(apiMock.deleteTimeCategory).toHaveBeenCalledWith(7))
    })

    it('asks a plain question before deactivating an unused category', async () => {
      await showCategories([category({})])
      fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }))
      const dialog = await screen.findByRole('alertdialog', { name: 'Deactivate "Ground School"?' })
      expect(dialog).not.toHaveTextContent('Existing time entries')
      fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }))
      await waitFor(() => expect(apiMock.deleteTimeCategory).toHaveBeenCalledWith(1))
    })

    it('confirms permanent deletion as a destructive action', async () => {
      await showCategories([category({})])
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
      const dialog = await screen.findByRole('alertdialog', { name: 'Permanently delete "Ground School"?' })
      expect(dialog).toHaveTextContent('This cannot be undone.')
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
      fireEvent.keyDown(document, { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
      expect(apiMock.deleteTimeCategory).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
      fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete permanently' }))
      await waitFor(() => expect(apiMock.deleteTimeCategory).toHaveBeenCalledWith(1))
    })
  })

  it('labels the time clock rules and explains each one in a help tip', async () => {
    render(<Settings />)
    expect(await screen.findByLabelText('Early clock-in buffer (minutes)')).toHaveValue(5)
    expect(screen.getByLabelText('Daily hours review alert after (hours)')).toHaveValue(8)
    expect(screen.getByLabelText('Weekly hours review alert after (hours)')).toHaveValue(40)

    const tip = screen.getByRole('button', { name: 'About Early clock-in buffer' })
    expect(tip).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(tip)
    expect(tip).toHaveAttribute('aria-expanded', 'true')
    const announcement = screen.getAllByRole('status').find(region => region.textContent?.includes('Early clock-in buffer'))
    expect(announcement).toHaveTextContent('Default5 minutes')
    expect(announcement).toHaveTextContent('Who can change itOwners and admins')
    expect(screen.getByRole('button', { name: 'About Daily hours review alert' })).toHaveAttribute('aria-expanded', 'false')
  })
})
