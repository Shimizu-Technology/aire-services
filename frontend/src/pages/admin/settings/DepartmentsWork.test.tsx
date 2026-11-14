import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import DepartmentsWork from './DepartmentsWork'

const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  categories: vi.fn(),
  updateSettings: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
}))
vi.mock('../../../lib/api', () => ({
  api: {
    getAdminAppSettings: mocks.settings,
    getAdminTimeCategories: mocks.categories,
    updateAdminAppSettings: mocks.updateSettings,
    updateTimeCategory: mocks.update,
    createTimeCategory: mocks.create,
    deleteTimeCategory: mocks.remove,
  },
}))
const flight = { id: 1, name: 'Flight', description: null, is_active: true, deletable: false }
const settingsWith = (label: string) => ({
  data: { catalog: [], approval_groups: [{ key: 'cfi', label }] },
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.settings.mockResolvedValue(settingsWith('CFI'))
  mocks.categories.mockResolvedValue({ data: { time_categories: [flight] } })
  mocks.updateSettings.mockResolvedValue({ data: {} })
})

it('after a later request fails, keeps the edits, says what was saved and discards back to the server state', async () => {
  const user = userEvent.setup()
  render(<RouterProvider router={createMemoryRouter([{ path: '/', element: <DepartmentsWork /> }])} />)
  await user.clear(await screen.findByLabelText('Department 1'))
  await user.type(screen.getByLabelText('Department 1'), 'CFI Team')
  await user.click(screen.getByRole('button', { name: 'Add kind of work' }))
  await user.type(screen.getByLabelText('Work name 2'), 'Planning')
  await user.click(screen.getByRole('button', { name: 'Add kind of work' }))
  mocks.create
    .mockResolvedValueOnce({ data: { time_category: { id: 2 } } })
    .mockResolvedValueOnce({ error: "Name can't be blank", status: 422 })
  mocks.settings.mockResolvedValue(settingsWith('CFI Team'))
  mocks.categories.mockResolvedValue({
    data: {
      time_categories: [flight, { ...flight, id: 2, name: 'Planning', deletable: true }],
    },
  })

  await user.click(screen.getByRole('button', { name: 'Save changes' }))

  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent("Name can't be blank")
  expect(alert).toHaveTextContent('Changes made before this problem are saved')
  expect(screen.queryByText('Changes saved')).toBeNull()
  expect(screen.getByLabelText('Work name 3')).toHaveValue('')

  await user.click(screen.getByRole('button', { name: 'Discard' }))
  await waitFor(() => expect(screen.queryByLabelText('Work name 3')).toBeNull())
  expect(screen.getByLabelText('Department 1')).toHaveValue('CFI Team')
  expect(screen.getByLabelText('Work name 2')).toHaveValue('Planning')
  expect(mocks.create).toHaveBeenCalledTimes(2)
})

it('labels the name and description fields for sighted users', async () => {
  render(<RouterProvider router={createMemoryRouter([{ path: '/', element: <DepartmentsWork /> }])} />)
  expect(await screen.findByPlaceholderText('Name of the work')).toBeInTheDocument()
  expect(screen.getByPlaceholderText('Description (optional)')).toBeInTheDocument()
  expect(screen.getByPlaceholderText('Department name')).toBeInTheDocument()
})

it('says nothing was saved when the first request is refused', async () => {
  const user = userEvent.setup()
  render(<RouterProvider router={createMemoryRouter([{ path: '/', element: <DepartmentsWork /> }])} />)
  await user.click(await screen.findByRole('button', { name: 'Remove' }))
  mocks.updateSettings.mockResolvedValue({
    error: 'Reassign users before removing departments currently in use: CFI',
    status: 422,
  })

  await user.click(screen.getByRole('button', { name: 'Save changes' }))

  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('currently in use: CFI. Nothing was saved.')
  expect(alert).not.toHaveTextContent('before this problem are saved')
})

const lunch = { id: 3, name: 'Lunch run', description: 'Fuel truck', is_active: true, deletable: true }
const renderPage = () =>
  render(<RouterProvider router={createMemoryRouter([{ path: '/', element: <DepartmentsWork /> }])} />)

it('asks before a permanent delete and writes nothing when the admin says no', async () => {
  const user = userEvent.setup()
  mocks.categories.mockResolvedValue({ data: { time_categories: [flight, lunch] } })
  renderPage()
  const deletes = await screen.findAllByRole('button', { name: 'Delete work category' })
  await user.click(deletes[0])
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('Permanently delete Lunch run?')
  expect(dialog).toHaveTextContent("This can't be undone.")
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  expect(mocks.remove).not.toHaveBeenCalled()
  expect(screen.getAllByText('You have unsaved changes').length).toBeGreaterThan(0)
})
it('deletes after the admin confirms', async () => {
  const user = userEvent.setup()
  mocks.categories.mockResolvedValue({ data: { time_categories: [flight, lunch] } })
  mocks.remove.mockResolvedValue({ status: 204 })
  renderPage()
  await user.click((await screen.findAllByRole('button', { name: 'Delete work category' }))[0])
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(3))
})
it("says it could not confirm what was saved when the request never got an answer", async () => {
  const user = userEvent.setup()
  renderPage()
  await user.click(await screen.findByRole('button', { name: 'Add kind of work' }))
  await user.type(screen.getByLabelText('Work name 2'), 'Planning')
  mocks.create.mockResolvedValue({ error: 'Failed to fetch' })
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent("We couldn't confirm what was saved")
  expect(alert).not.toHaveTextContent('Nothing was saved')
  expect(mocks.categories).toHaveBeenCalledTimes(2)
})
it('does not leave a created row looking unsaved after a later row fails', async () => {
  const user = userEvent.setup()
  renderPage()
  await user.click(await screen.findByRole('button', { name: 'Add kind of work' }))
  await user.type(screen.getByLabelText('Work name 2'), 'Planning')
  await user.click(screen.getByRole('button', { name: 'Add kind of work' }))
  mocks.create
    .mockResolvedValueOnce({ data: { time_category: { id: 2, name: 'Planning', description: null, is_active: true } } })
    .mockResolvedValueOnce({ error: "Name can't be blank", status: 422 })
  mocks.categories.mockResolvedValue({
    data: { time_categories: [flight, { ...flight, id: 2, name: 'Planning', deletable: true }] },
  })
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  await screen.findByRole('alert')
  const blankRow = screen.getByLabelText('Work name 3').closest('div')!
  await user.click(within(blankRow).getByRole('button', { name: 'Delete work category' }))
  await waitFor(() => expect(screen.queryAllByText('You have unsaved changes')).toHaveLength(0))
})

const planning = { id: 2, name: 'Planning', description: null, is_active: true, deletable: true }

// The create reached the server but its answer never reached the page.
for (const [label, lost] of [
  ['no status', { error: 'Failed to fetch' }],
  ['a server error', { error: 'Bad gateway', status: 502 }],
  ['an unreadable success', { error: 'Server returned an invalid response (200)', status: 200 }],
] as const) {
  it(`adopts the saved row after a lost create (${label}) instead of offering to delete it`, async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Add kind of work' }))
    await user.type(screen.getByLabelText('Work name 2'), 'Planning')
    mocks.create.mockResolvedValue(lost)
    mocks.categories.mockResolvedValue({ data: { time_categories: [flight, planning] } })

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't confirm what was saved")
    expect(screen.queryByLabelText('Work name 3')).toBeNull()
    expect(screen.getByLabelText('Work name 2')).toHaveValue('Planning')
    expect(screen.queryAllByText('You have unsaved changes')).toHaveLength(0)

    // The next Save must not treat the saved Planning row as something the admin removed.
    await user.type(screen.getByLabelText('Department 1'), ' Team')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(mocks.updateSettings).toHaveBeenCalled())
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.remove).not.toHaveBeenCalled()
  })
}
it('resets to the server list when a lost create cannot be matched to one new row', async () => {
  const user = userEvent.setup()
  renderPage()
  await user.click(await screen.findByRole('button', { name: 'Add kind of work' }))
  await user.type(screen.getByLabelText('Work name 2'), 'Planning')
  await user.click(screen.getByRole('button', { name: 'Add kind of work' }))
  await user.type(screen.getByLabelText('Work name 3'), 'Planning')
  mocks.create.mockResolvedValue({ error: 'Failed to fetch' })
  mocks.categories.mockResolvedValue({ data: { time_categories: [flight, planning] } })

  await user.click(screen.getByRole('button', { name: 'Save changes' }))

  expect(await screen.findByRole('alert')).toHaveTextContent(
    "We couldn't confirm what was saved. This is what's saved now; check it and make any changes again.",
  )
  expect(screen.queryByLabelText('Work name 3')).toBeNull()
  expect(screen.getByLabelText('Work name 2')).toHaveValue('Planning')
  expect(screen.queryAllByText('You have unsaved changes')).toHaveLength(0)
  expect(mocks.create).toHaveBeenCalledTimes(1)
})
it('shows a row that appeared on the server and never offers to delete it', async () => {
  const user = userEvent.setup()
  renderPage()
  await user.click(await screen.findByRole('button', { name: 'Add kind of work' }))
  mocks.create.mockResolvedValue({ error: "Name can't be blank", status: 422 })
  mocks.categories.mockResolvedValue({
    data: { time_categories: [flight, { ...planning, id: 9, name: 'Fuel truck' }] },
  })

  await user.click(screen.getByRole('button', { name: 'Save changes' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('New in the list: Fuel truck.')
  expect(screen.getByDisplayValue('Fuel truck')).toBeInTheDocument()
  await user.type(screen.getByLabelText('Department 1'), ' Team')
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  await waitFor(() => expect(mocks.updateSettings).toHaveBeenCalled())
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(mocks.remove).not.toHaveBeenCalled()
})
it('keeps Save off until the list is reloaded when the server cannot be re-read', async () => {
  const user = userEvent.setup()
  renderPage()
  await user.click(await screen.findByRole('button', { name: 'Add kind of work' }))
  await user.type(screen.getByLabelText('Work name 2'), 'Planning')
  mocks.create.mockResolvedValue({ error: 'Failed to fetch' })
  mocks.categories.mockRejectedValue(new Error('offline'))

  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Reload the page to see what is saved')

  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Reload the page to see what is saved')
  expect(mocks.create).toHaveBeenCalledTimes(1)
})
it('does not keep the unsaved bar on when the server lists the adopted row in a different order', async () => {
  const user = userEvent.setup()
  renderPage()
  await user.click(await screen.findByRole('button', { name: 'Add kind of work' }))
  await user.type(screen.getByLabelText('Work name 2'), 'Aerial tour')
  mocks.create.mockResolvedValue({ error: 'Failed to fetch' })
  // The server lists work alphabetically, so the new row comes first.
  mocks.categories.mockResolvedValue({
    data: { time_categories: [{ ...planning, id: 2, name: 'Aerial tour' }, flight] },
  })
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  await screen.findByRole('alert')
  expect(screen.queryAllByText('You have unsaved changes')).toHaveLength(0)
})
