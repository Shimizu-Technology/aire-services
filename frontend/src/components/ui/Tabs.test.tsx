import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { Tabs } from './Tabs'

function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.pathname + location.search}</p>
}

function renderTabs(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Tabs
        label="Ethan Cruz"
        items={[{ value: 'overview', label: 'Overview' }, { value: 'time', label: 'Time' }, { value: 'pay', label: 'Pay' }, { value: 'access', label: 'Access' }]}
        aliases={{ hours: 'time', setup: 'access' }}
      >
        {(tab) => <p>{`${tab} panel`}</p>}
      </Tabs>
      <Where />
    </MemoryRouter>,
  )
}

const where = () => screen.getByTestId('where').textContent

describe('Tabs', () => {
  it('shows the tab named in the URL, with tablist and tabpanel roles', () => {
    renderTabs('/admin/users/9?tab=pay')
    expect(screen.getByRole('tablist', { name: 'Ethan Cruz' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Pay' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'Pay' })).toHaveTextContent('pay panel')
  })

  it('falls back to the first tab for a missing or unknown key', () => {
    renderTabs('/admin/users/9?tab=nonsense')
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
  })

  it("rewrites old keys and keeps Cornerstone's other parameters", () => {
    renderTabs('/admin/users/9?tab=hours&period=2026-10-16&entry=55')
    expect(screen.getByRole('tab', { name: 'Time' })).toHaveAttribute('aria-selected', 'true')
    expect(where()).toBe('/admin/users/9?tab=time&period=2026-10-16&entry=55')
  })

  it('writes the chosen tab to the URL and moves with arrow keys', async () => {
    const user = userEvent.setup()
    renderTabs('/admin/users/9?period=2026-11-01')
    await user.click(screen.getByRole('tab', { name: 'Time' }))
    expect(where()).toBe('/admin/users/9?period=2026-11-01&tab=time')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('time panel')
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Pay' })).toHaveFocus()
    expect(where()).toContain('tab=pay')
    await user.keyboard('{End}')
    expect(where()).toContain('tab=access')
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('tabindex', '-1')
  })

  it('keeps 44px tab targets', () => {
    renderTabs('/admin/users/9')
    for (const tab of screen.getAllByRole('tab')) expect(tab).toHaveClass('min-h-11')
  })
})
