import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, Link } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import SettingsPage from './SettingsPage'
import { settingsPages, type SettingsPageId } from './settingsPages'
import fixture from '../../../test/fixtures/settings-catalog.json'

const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }))
vi.mock('../../../lib/api', () => ({ api: { getAdminAppSettings: mocks.get } }))
vi.mock('../../../lib/api/settings', () => ({ settingsApi: { save: mocks.save } }))
vi.mock('../../../lib/payStubsApi', () => ({
  payStubsApi: {
    notificationEmails: vi.fn().mockResolvedValue({ emails: [], editable: true }),
    updateNotificationEmails: vi.fn().mockResolvedValue({ emails: ['ops@example.com'] }),
  },
}))
const settings = Object.fromEntries(
  Object.values(settingsPages)
    .flatMap((page) => page.keys)
    .map((key) => [
      key,
      key.endsWith('emails')
        ? ''
        : ['clock_in_location_name'].includes(key)
          ? 'AIRE'
          : key.includes('hours')
            ? '8'
            : 'false',
    ]),
)
function mount(page: SettingsPageId) {
  return render(
    <RouterProvider
      router={createMemoryRouter([
        {
          path: '/',
          element: (
            <>
              <Link to="/away">Leave</Link>
              <SettingsPage page={page} />
            </>
          ),
        },
        { path: '/away', element: <p>Away</p> },
      ])}
    />,
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.get.mockResolvedValue({ data: { settings, catalog: fixture } })
  mocks.save.mockImplementation(async (changes: Record<string, string>) => ({
    data: { settings: { ...settings, ...changes }, catalog: fixture },
  }))
})
for (const [page, config] of Object.entries(settingsPages)) {
  for (const key of config.keys.filter((key) => key !== 'pay_stub_request_notification_emails')) {
    it(`saves only ${key} on ${page}`, async () => {
      const user = userEvent.setup()
      const baseline = { ...settings, schedules_enabled: 'true' }
      mocks.get.mockResolvedValue({ data: { settings: baseline, catalog: fixture } })
      mocks.save.mockImplementation(async (changes: Record<string, string>) => ({
        data: { settings: { ...baseline, ...changes }, catalog: fixture },
      }))
      mount(page as SettingsPageId)
      const label =
        key === 'clock_in_location_latitude'
          ? 'Latitude'
          : key === 'clock_in_location_longitude'
            ? 'Longitude'
            : fixture.find((entry) => (entry.setting_keys as string[]).includes(key))!.label
      await screen.findByText(label, { selector: 'label' })
      const control = screen.queryByRole('switch', { name: label })
      if (control) await user.click(control)
      else {
        const input = screen.getByLabelText(label)
        await user.clear(input)
        await user.type(
          input,
          key.endsWith('emails')
            ? 'ops@example.com{Enter}'
            : key === 'clock_in_location_name'
              ? 'Hangar'
              : '10',
        )
      }
      await user.click(screen.getByRole('button', { name: 'Save changes' }))
      if ((['schedules_enabled', 'auto_approve_ordinary_shifts'] as string[]).includes(key)) {
        await user.click(screen.getAllByRole('button', { name: 'Save changes' }).at(-1)!)
      }
      await waitFor(() => expect(mocks.save).toHaveBeenCalled())
      expect(Object.keys(mocks.save.mock.calls[0][0])).toEqual([key])
    })
  }
}
it('disables Require while schedules are off', async () => {
  mount('schedules')
  expect(
    await screen.findByRole('switch', { name: 'Require a scheduled shift to clock in' }),
  ).toBeDisabled()
})
it('keeps editing or discards on navigation', async () => {
  const user = userEvent.setup()
  mount('approvals')
  await user.click(
    await screen.findByRole('switch', { name: 'Managers can approve their own time' }),
  )
  await user.click(screen.getByText('Leave'))
  await user.click(screen.getByRole('button', { name: 'Keep editing' }))
  expect(screen.getByRole('heading', { name: 'Approvals' })).toBeInTheDocument()
  await user.click(screen.getByText('Leave'))
  await user.click(screen.getByRole('button', { name: 'Discard changes' }))
  expect(await screen.findByText('Away')).toBeInTheDocument()
})
it('rejects malformed reminder recipients', async () => {
  const user = userEvent.setup()
  mount('approvals')
  await user.type(await screen.findByLabelText('Cutoff reminder recipients'), 'invalid{Enter}')
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Enter valid reminder email addresses')
  expect(mocks.save).not.toHaveBeenCalled()
})
