import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { ShellChromeProvider } from '../components/layouts/ShellChromeContext'
import { mockMatchMedia } from './matchMedia'
import { UiKitPagesFixture } from './UiKitPagesFixture'

let restore = () => undefined as void
afterEach(() => restore())

function renderFixture(url: string) {
  const router = createMemoryRouter([
    { path: '/admin/users/:id', element: <ShellChromeProvider><UiKitPagesFixture now={new Date('2026-11-11T00:00:00Z')} /></ShellChromeProvider> },
    { path: '/admin/users', element: <p>Team</p> },
  ], { initialEntries: [url] })
  render(<RouterProvider router={router} />)
  return router
}

describe('UI kit fixture: pages and forms together', () => {
  it('opens an old tab link, edits behind one Save, and guards leaving', async () => {
    restore = mockMatchMedia({ width: 390 })
    const user = userEvent.setup()
    const router = renderFixture('/admin/users/7?tab=setup')
    expect(screen.getByRole('tab', { name: 'Access' })).toHaveAttribute('aria-selected', 'true')
    expect(router.state.location.search).toBe('?tab=access')

    await user.click(screen.getByRole('switch', { name: 'My Pay' }))
    expect(screen.getByRole('region', { name: 'Unsaved changes' })).toHaveTextContent('My Pay: Off → On')

    await user.click(screen.getByRole('tab', { name: 'Overview' }))
    expect(screen.getByRole('alertdialog', { name: 'Leave without saving?' })).toHaveAccessibleDescription('Your changes to Access will be lost.')
    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await user.click(screen.getByRole('tab', { name: 'Overview' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(router.state.location.search).toBe('?tab=overview')
  })

  it('renders the overview pieces with their roles', async () => {
    restore = mockMatchMedia({ width: 1280 })
    const user = userEvent.setup()
    renderFixture('/admin/users/7')
    expect(screen.getByText('Nov 1–15').parentElement).toHaveTextContent('this pay period')
    await user.click(screen.getByRole('button', { name: 'Previous pay period' }))
    expect(screen.getByText('Oct 16–31')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '51.5h approved, 11.5h waiting' })).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Needs attention' })).getAllByRole('listitem')).toHaveLength(2)
    expect(within(screen.getByRole('list', { name: 'Before it locks' })).getAllByRole('listitem')[0]).toHaveTextContent('To do:')
    expect(within(screen.getByRole('list', { name: 'Hand-off to Cornerstone Payroll' })).getAllByRole('listitem')[1]).toHaveAttribute('aria-current', 'step')
    expect(screen.getByText('On the clock for about an hour')).toBeInTheDocument()
  })
})
