import type { ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Settings from './Settings'
import type { SettingsCatalogEntry, TimeClockAppSettings } from '../../lib/api'
import { defaultPublicContactSettings } from '../../lib/businessInfo'
import { defaultSocialLinks } from '../../lib/socialLinks'
// Written by the backend (spec/models/settings_catalog_spec.rb) from SettingsCatalog.
import catalogFixture from '../../test/fixtures/settings-catalog.json'

// Every setting the page shows must be explained by the backend's catalog,
// so a setting can't be added to the page without its help text.

const catalog = catalogFixture as SettingsCatalogEntry[]

// Every key the Settings page reads and saves. Typed so adding a field to
// TimeClockAppSettings fails to compile until it is listed here, and then
// fails below until the catalog explains it.
const SETTINGS_PAGE_KEYS: Record<keyof TimeClockAppSettings, true> = {
  overtime_daily_threshold_hours: true,
  overtime_weekly_threshold_hours: true,
  early_clock_in_buffer_minutes: true,
  clock_in_location_enforced: true,
  clock_in_location_name: true,
  clock_in_location_latitude: true,
  clock_in_location_longitude: true,
  clock_in_location_radius_meters: true,
  schedule_required_for_clock_in: true,
  managers_can_approve_own_time: true,
  pay_stub_kiosk_requests_enabled: true,
  pay_stub_self_email_enabled: true,
}

// The other things the page edits, stored outside TimeClockAppSettings.
const OTHER_PAGE_SETTINGS = ['approval_groups', 'contact_email', 'contact_inquiry_topics', 'public_contact_settings', 'public_social_links', 'pay_stub_request_notification_emails']

const sources = import.meta.glob<string>(['./Settings.tsx', '../../components/pay-stubs/PayStubSettings.tsx'], { query: '?raw', import: 'default', eager: true })

const apiMock = vi.hoisted(() => ({
  getAdminTimeCategories: vi.fn(),
  getAdminAppSettings: vi.fn(),
  getAdminContactSettings: vi.fn(),
}))
vi.mock('../../lib/api', () => ({ api: apiMock }))
vi.mock('../../lib/payStubsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/payStubsApi')>()
  return { ...actual, payStubsApi: { notificationEmails: vi.fn().mockResolvedValue({ emails: [], editable: true }), updateNotificationEmails: vi.fn() } }
})
vi.mock('../../components/ui/MotionComponents', () => ({
  FadeUp: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

function renderSettings(entries: SettingsCatalogEntry[] = catalog) {
  apiMock.getAdminAppSettings.mockResolvedValue({
    data: {
      settings: {
        overtime_daily_threshold_hours: '8',
        overtime_weekly_threshold_hours: '40',
        early_clock_in_buffer_minutes: '5',
        schedule_required_for_clock_in: 'false',
        clock_in_location_enforced: 'false',
        clock_in_location_name: 'AIRE Services Guam',
        clock_in_location_latitude: '13.46913',
        clock_in_location_longitude: '144.79901',
        clock_in_location_radius_meters: '1000',
        managers_can_approve_own_time: 'true',
        pay_stub_kiosk_requests_enabled: 'false',
        pay_stub_self_email_enabled: 'false',
      },
      approval_groups: [{ key: 'cfi', label: 'CFI' }],
      catalog: entries,
    },
  })
  return render(<Settings />, { wrapper: MemoryRouter })
}

describe('Settings help comes from the settings catalog', () => {
  beforeEach(() => {
    vi.stubGlobal('scrollTo', vi.fn())
    apiMock.getAdminTimeCategories.mockResolvedValue({ data: { time_categories: [] } })
    apiMock.getAdminContactSettings.mockResolvedValue({
      data: { contact_notification_emails: ['ops@example.com'], inquiry_topics: ['General Inquiry'], public_contact: defaultPublicContactSettings, social_links: defaultSocialLinks },
    })
  })

  it('has a catalog entry for every setting the page reads or saves', () => {
    const documented = new Set(catalog.flatMap((entry) => entry.setting_keys))
    const missing = [...Object.keys(SETTINGS_PAGE_KEYS), ...OTHER_PAGE_SETTINGS].filter((key) => !documented.has(key))
    expect(missing).toEqual([])
  })

  it('shows one help tip per catalog entry, and none written by hand', async () => {
    renderSettings()
    await screen.findByRole('button', { name: 'About Early clock-in buffer' })

    const tips = screen.getAllByRole('button', { name: /^About / }).map((button) => button.getAttribute('aria-label'))
    expect(tips.sort()).toEqual(catalog.map((entry) => `About ${entry.label}`).sort())

    for (const [path, source] of Object.entries(sources)) {
      expect(source, `${path} should use SettingHelp, not HelpTip`).not.toMatch(/<HelpTip\b/)
      const ids = [...source.matchAll(/<SettingHelp id="([^"]+)"/g)].map((match) => match[1])
      expect(ids.filter((id) => !catalog.some((entry) => entry.id === id)), path).toEqual([])
    }
  })

  it('opens a tip with what it does, the default, who can change it and an example', async () => {
    const user = userEvent.setup()
    renderSettings()
    await user.click(await screen.findByRole('button', { name: 'About Managers can approve their own time' }))

    const entry = catalog.find((candidate) => candidate.id === 'managers_can_approve_own_time')!
    const announcement = screen.getAllByRole('status').find((region) => region.textContent?.includes(entry.what))
    expect(announcement).toHaveTextContent(`What it does${entry.what}`)
    expect(announcement).toHaveTextContent(`DefaultOn`)
    expect(announcement).toHaveTextContent('Who can change itOwners and admins')
    expect(announcement).toHaveTextContent(`Example${entry.example}`)
  })

  it('lists settings changed on another page and links there', async () => {
    renderSettings()
    const section = await screen.findByRole('region', { name: 'Set on other pages' })
    expect(within(section).getByRole('button', { name: 'About My Pay for everyone' })).toBeInTheDocument()
    expect(within(section).getAllByRole('link', { name: 'Team page' })[0]).toHaveAttribute('href', '/admin/users')
  })

  it('shows the scheduled-shift rule read-only, with its current value', async () => {
    renderSettings()
    await screen.findByRole('button', { name: 'About Require a scheduled shift to clock in' })
    expect(screen.getByText("Shown for reference. There's no switch for this here yet.")).toBeInTheDocument()
  })

  it('links to Roles & access', async () => {
    renderSettings()
    expect(await screen.findByRole('link', { name: 'Roles & access' })).toHaveAttribute('href', '/admin/settings/roles')
  })

  it('still works, without tips, if the catalog is missing', async () => {
    renderSettings([])
    expect(await screen.findByLabelText('Early clock-in buffer (minutes)')).toHaveValue(5)
    expect(screen.queryAllByRole('button', { name: /^About / })).toEqual([])
  })
})
