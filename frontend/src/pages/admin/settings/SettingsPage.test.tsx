import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, Link } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { PayStubError } from '../../../lib/payStubsApi'
import SettingsPage from './SettingsPage'
import { settingsPages, type SettingsPageId } from './settingsPages'
import fixture from '../../../test/fixtures/settings-catalog.json'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  refresh: vi.fn(),
  recipients: vi.fn(),
  updateRecipients: vi.fn(),
}))
vi.mock('../../../lib/api', () => ({ api: { getAdminAppSettings: mocks.get } }))
vi.mock('../../../lib/api/settings', () => ({ settingsApi: { save: mocks.save } }))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuthContext: () => ({ refreshCurrentUser: mocks.refresh }),
}))
vi.mock('../../../lib/payStubsApi', async (importActual) => ({
  ...(await importActual<typeof import('../../../lib/payStubsApi')>()),
  payStubsApi: { notificationEmails: mocks.recipients, updateNotificationEmails: mocks.updateRecipients },
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
  mocks.refresh.mockResolvedValue(true)
  mocks.recipients.mockResolvedValue({ emails: [], editable: true })
  mocks.updateRecipients.mockResolvedValue({ emails: ['ops@example.com'] })
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
      if (key === 'schedules_enabled') {
        await user.click(screen.getAllByRole('button', { name: 'Save changes' }).at(-1)!)
      }
      if (key === 'auto_approve_ordinary_shifts') {
        await user.click(screen.getByRole('button', { name: 'Turn on' }))
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
it('lowercases and de-duplicates reminder recipients before saving', async () => {
  const user = userEvent.setup()
  mount('approvals')
  await user.type(
    await screen.findByLabelText('Cutoff reminder recipients'),
    'Ops@Example.com, ops@example.com',
  )
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  await waitFor(() => expect(mocks.save).toHaveBeenCalled())
  expect(mocks.save.mock.calls[0][0]).toEqual({ payroll_cutoff_reminder_emails: 'ops@example.com' })
})
it('says the recipient list was saved when the settings request fails, then clears the bar on retry', async () => {
  const user = userEvent.setup()
  mocks.save.mockResolvedValueOnce({ error: 'Server said no' })
  mount('pay-stubs')
  await user.click(await screen.findByRole('switch', { name: 'Pay stub requests at the kiosk' }))
  await user.type(
    screen.getByLabelText('Heads-up emails for kiosk requests'),
    'Ops@Example.com',
  )
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The heads-up email list was saved, but your other changes were not: Server said no',
  )
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByText('Changes saved')).toBeInTheDocument()
  expect(screen.queryAllByText('You have unsaved changes')).toHaveLength(0)
})
it('drops the saved message as soon as the admin edits again', async () => {
  const user = userEvent.setup()
  mount('approvals')
  const own = await screen.findByRole('switch', { name: 'Managers can approve their own time' })
  await user.click(own)
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByText('Changes saved')).toBeInTheDocument()
  await user.click(own)
  expect(screen.queryByText('Changes saved')).toBeNull()
})

function load(overrides: Record<string, string>) {
  const baseline = { ...settings, ...overrides }
  mocks.get.mockResolvedValue({ data: { settings: baseline, catalog: fixture } })
  mocks.save.mockImplementation(async (changes: Record<string, string>) => ({
    data: { settings: { ...baseline, ...changes }, catalog: fixture },
  }))
}
const requireSwitch = () =>
  screen.findByRole('switch', { name: 'Require a scheduled shift to clock in' })

it('turns Require off in the draft and says so when Use schedules is switched off', async () => {
  const user = userEvent.setup()
  load({ schedules_enabled: 'true', schedule_required_for_clock_in: 'true' })
  mount('schedules')
  await user.click(await screen.findByRole('switch', { name: 'Use schedules' }))
  expect(await requireSwitch()).not.toBeChecked()
  expect(await requireSwitch()).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent(
    'This also turns off Require a scheduled shift, so everyone can clock in.',
  )
  await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
  await waitFor(() => expect(mocks.save).toHaveBeenCalled())
  expect(mocks.save.mock.calls[0][0]).toEqual({
    schedules_enabled: 'false',
    schedule_required_for_clock_in: 'false',
  })
})
it('restores the saved Require when Use schedules is switched back on', async () => {
  const user = userEvent.setup()
  load({ schedules_enabled: 'true', schedule_required_for_clock_in: 'true' })
  mount('schedules')
  const use = await screen.findByRole('switch', { name: 'Use schedules' })
  await user.click(use)
  await user.click(use)
  expect(await requireSwitch()).toBeChecked()
  expect(screen.queryAllByText('You have unsaved changes')).toHaveLength(0)
})
it('refreshes the menu after Use schedules is saved', async () => {
  const user = userEvent.setup()
  mount('schedules')
  await user.click(await screen.findByRole('switch', { name: 'Use schedules' }))
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByText('Changes saved. Schedule is now in everyone’s menu.')).toBeInTheDocument()
  expect(mocks.refresh).toHaveBeenCalledWith({ background: true })
})
it('does not refresh the menu for settings that do not touch it', async () => {
  const user = userEvent.setup()
  mount('approvals')
  await user.click(await screen.findByRole('switch', { name: 'Managers can approve their own time' }))
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByText('Changes saved')).toBeInTheDocument()
  expect(mocks.refresh).not.toHaveBeenCalled()
})
it('asks the full auto-approval question when turning it on', async () => {
  const user = userEvent.setup()
  mount('approvals')
  await user.click(await screen.findByRole('switch', { name: 'Auto-approve ordinary shifts' }))
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('Turn on auto-approval?')
  expect(dialog).toHaveTextContent(
    'Chels and the CEO must agree before this is turned on. Employees’ ordinary kiosk and mobile shifts will be approved at clock-out without a manager looking at them.',
  )
  expect(dialog).toHaveTextContent(
    'Overtime, edits, manual entries, missed clock-outs, late hours and supervisors’ own time still go to the queue.',
  )
  expect(within(dialog).getByRole('button', { name: 'Turn on' })).toBeInTheDocument()
})
it('keeps the short confirm when auto-approval is turned off', async () => {
  const user = userEvent.setup()
  load({ auto_approve_ordinary_shifts: 'true' })
  mount('approvals')
  await user.click(await screen.findByRole('switch', { name: 'Auto-approve ordinary shifts' }))
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByRole('alertdialog')).toHaveTextContent('Change Auto-approve ordinary shifts?')
})
it('shows the server message when the recipient list is refused', async () => {
  const user = userEvent.setup()
  mocks.updateRecipients.mockRejectedValueOnce(
    new PayStubError("These don't look like email addresses: nope", 'invalid_email', 422),
  )
  mount('pay-stubs')
  await user.type(await screen.findByLabelText('Heads-up emails for kiosk requests'), 'nope')
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    "These don't look like email addresses: nope",
  )
})
it('shows the Pay stubs form only once switches and recipients have both loaded', async () => {
  let release: (value: { emails: string[]; editable: boolean }) => void = () => {}
  mocks.recipients.mockReturnValue(new Promise((resolve) => (release = resolve)))
  load({ pay_stub_kiosk_requests_enabled: 'true' })
  mount('pay-stubs')
  await waitFor(() => expect(mocks.recipients).toHaveBeenCalled())
  expect(screen.queryByRole('switch')).toBeNull()
  expect(screen.queryAllByText('You have unsaved changes')).toHaveLength(0)
  release({ emails: ['ops@example.com'], editable: true })
  const kiosk = await screen.findByRole('switch', { name: 'Pay stub requests at the kiosk' })
  expect(kiosk).toBeChecked()
  expect(screen.queryAllByText('You have unsaved changes')).toHaveLength(0)
})
it('shows an error with a retry when the recipient list cannot be loaded', async () => {
  const user = userEvent.setup()
  mocks.recipients.mockRejectedValueOnce(new PayStubError('Something went wrong.', 'unavailable', 500))
  mount('pay-stubs')
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the heads-up email list')
  expect(screen.queryByRole('switch')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Reload settings' }))
  expect(await screen.findByRole('switch', { name: 'Pay stub requests at the kiosk' })).toBeInTheDocument()
})
for (const [key, label, ask] of [
  ['overtime_daily_threshold_hours', 'Daily hours review alert', 'Enter a number of hours'],
  ['early_clock_in_buffer_minutes', 'Early clock-in buffer', 'Enter a number of minutes'],
  ['clock_in_location_radius_meters', 'Allowed radius', 'Enter a distance in meters'],
  ['clock_in_location_name', 'Location label', 'Enter a location name'],
] as const) {
  it(`will not save ${label} when it is cleared`, async () => {
    const user = userEvent.setup()
    load({ [key]: key === 'clock_in_location_name' ? 'AIRE' : '8' })
    mount('time-clock')
    await user.clear(await screen.findByLabelText(label))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(`${label}: ${ask}.`)
    expect(mocks.save).not.toHaveBeenCalled()
    expect(screen.getAllByText('You have unsaved changes').length).toBeGreaterThan(0)
  })
}
it('will not save a number field that is not a number', async () => {
  const user = userEvent.setup()
  mount('time-clock')
  await user.clear(await screen.findByLabelText('Weekly hours review alert'))
  await user.type(screen.getByLabelText('Weekly hours review alert'), 'forty')
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Enter a number of hours')
  expect(mocks.save).not.toHaveBeenCalled()
})
it('accepts the reminder addresses the server accepts', async () => {
  const user = userEvent.setup()
  mount('approvals')
  await user.type(
    await screen.findByLabelText('Cutoff reminder recipients'),
    "a@b, o'brien+pay@example.com",
  )
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  await waitFor(() => expect(mocks.save).toHaveBeenCalled())
  expect(mocks.save.mock.calls[0][0]).toEqual({
    payroll_cutoff_reminder_emails: "a@b, o'brien+pay@example.com",
  })
})
it('refuses reminder addresses the server would refuse', async () => {
  const user = userEvent.setup()
  mount('approvals')
  await user.type(await screen.findByLabelText('Cutoff reminder recipients'), 'two words@example.com')
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Enter valid reminder email addresses')
  expect(mocks.save).not.toHaveBeenCalled()
})
it('allows 10 reminder recipients and refuses 11', async () => {
  const user = userEvent.setup()
  const list = (count: number) =>
    Array.from({ length: count }, (_, index) => `p${index}@example.com`).join(', ')
  mount('approvals')
  const field = await screen.findByLabelText('Cutoff reminder recipients')
  await user.type(field, list(11))
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Use 10 addresses or fewer.')
  expect(mocks.save).not.toHaveBeenCalled()
  await user.clear(field)
  await user.type(field, list(10))
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  await waitFor(() => expect(mocks.save).toHaveBeenCalled())
})
it('Turn off Require sends only that key and keeps other unsaved edits', async () => {
  const user = userEvent.setup()
  load({ schedules_enabled: 'false', schedule_required_for_clock_in: 'true' })
  mount('schedules')
  const use = await screen.findByRole('switch', { name: 'Use schedules' })
  await user.click(use)
  await user.click(screen.getByRole('button', { name: 'Turn off Require' }))
  await waitFor(() => expect(mocks.save).toHaveBeenCalled())
  expect(mocks.save.mock.calls[0][0]).toEqual({ schedule_required_for_clock_in: 'false' })
  await waitFor(() => expect(screen.queryByText('Nobody without a shift can clock in right now')).toBeNull())
  expect(screen.getByRole('switch', { name: 'Use schedules' })).toBeChecked()
  expect(screen.getAllByText('You have unsaved changes').length).toBeGreaterThan(0)
})
