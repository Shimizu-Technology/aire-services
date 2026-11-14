import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import SettingsHome from './SettingsHome'
import { settingsAnchorPaths } from '../AdminRedirects'

vi.mock('../../../lib/api', () => ({
  api: {
    getAdminAppSettings: vi.fn().mockResolvedValue({ data: { settings: {}, approval_groups: [] } }),
    getAdminTimeCategories: vi.fn().mockResolvedValue({ data: { time_categories: [] } }),
  },
}))
vi.mock('../../../lib/api/settings', () => ({
  settingsApi: { connection: vi.fn().mockResolvedValue({ data: { state: 'connected' } }) },
}))
function Destination() {
  const location = useLocation()
  return <p>{location.pathname}</p>
}
for (const [hash, path] of Object.entries(settingsAnchorPaths)) {
  it(`redirects ${hash} to ${path}`, async () => {
    render(
      <RouterProvider
        router={createMemoryRouter(
          [
            { path: '/admin/settings', element: <SettingsHome /> },
            { path: '*', element: <Destination /> },
          ],
          { initialEntries: [`/admin/settings${hash}`] },
        )}
      />,
    )
    expect(await screen.findByText(path)).toBeInTheDocument()
  })
}
it('reads the current state in plain words', async () => {
  render(
    <RouterProvider
      router={createMemoryRouter([{ path: '/admin/settings', element: <SettingsHome /> }], {
        initialEntries: ['/admin/settings'],
      })}
    />,
  )
  expect(await screen.findByText('Connected')).toBeInTheDocument()
  expect(screen.getByText('Off')).toBeInTheDocument()
  expect(screen.getByText(/no reminders/)).toBeInTheDocument()
  expect(screen.getByText('0 departments · 0 kinds of work')).toBeInTheDocument()
})
