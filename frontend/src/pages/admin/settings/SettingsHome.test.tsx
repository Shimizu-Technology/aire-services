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
