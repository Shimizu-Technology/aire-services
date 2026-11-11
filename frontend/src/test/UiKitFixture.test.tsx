import '@testing-library/jest-dom'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShellChromeProvider } from '../components/layouts/ShellChromeContext'
import { useShellChrome } from '../components/layouts/shellChrome'
import { ToastProvider } from '../components/ui'
import { mockMatchMedia } from './matchMedia'
import { UiKitFixture } from './UiKitFixture'

function TabBarProbe() {
  return <p>{useShellChrome().selectionBarActive ? 'tab bar hidden' : 'tab bar shown'}</p>
}

// The toast's region; the offline banner is a status region too.
const toastRegion = () => screen.getAllByRole('status').find(region => region.getAttribute('aria-atomic') === 'true')!

function renderFixture(onApprove = vi.fn()) {
  render(
    <ShellChromeProvider>
      <ToastProvider>
        <TabBarProbe />
        <UiKitFixture onApprove={onApprove} />
      </ToastProvider>
    </ShellChromeProvider>,
  )
  return onApprove
}

let restore = () => undefined as void
afterEach(() => restore())

describe('UI kit fixture: lists, selection and feedback together', () => {
  it('selects across groups, approves exactly the selected shifts and offers Undo', async () => {
    restore = mockMatchMedia({ width: 390 })
    const user = userEvent.setup()
    const onApprove = renderFixture()
    const list = screen.getByRole('list', { name: 'Ordinary shifts by person' })

    await user.click(within(list).getByRole('button', { name: "Show Marcus Quinata's shifts" }))
    await user.click(screen.getByRole('checkbox', { name: 'Select Marcus Quinata, Tue, Nov 10' }))
    expect(screen.getByRole('checkbox', { name: "Select Marcus Quinata's shifts" })).toBePartiallyChecked()
    expect(screen.getByText('tab bar hidden')).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: "Select Grace Torres's shifts" }))
    const bar = screen.getByRole('region', { name: 'Selected shifts' })
    expect(bar).toHaveTextContent('2 shifts')
    expect(bar).toHaveTextContent('2 people · 17.6h')

    await user.click(within(bar).getByRole('button', { name: 'Approve 2' }))
    expect(onApprove).toHaveBeenCalledWith([11, 21])
    expect(screen.queryByRole('region', { name: 'Selected shifts' })).not.toBeInTheDocument()
    expect(screen.getByText('tab bar shown')).toBeInTheDocument()
    expect(toastRegion()).toHaveTextContent('Approved 2 shifts for 2 people')
    expect(screen.queryByRole('checkbox', { name: "Select Grace Torres's shifts" })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(toastRegion()).toHaveTextContent('Moved 2 shifts back to waiting.')
    expect(screen.getByRole('checkbox', { name: "Select Grace Torres's shifts" })).toBeInTheDocument()
  })

  it('approves one group from the keyboard and shows the empty and error states', async () => {
    restore = mockMatchMedia({ width: 1280 })
    const user = userEvent.setup()
    const onApprove = renderFixture()
    const list = screen.getByRole('list', { name: 'Ordinary shifts by person' })
    const rows = within(list).getAllByRole('group')
    act(() => rows[0].focus())
    await user.keyboard('{ArrowDown}')
    expect(rows[1]).toHaveFocus()
    await user.tab()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Approve 1 shift for Grace Torres' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onApprove).toHaveBeenLastCalledWith([21])

    await user.click(screen.getByRole('button', { name: 'Approve 2 shifts for Marcus Quinata' }))
    await user.click(screen.getByRole('button', { name: 'Approve 2 shifts for Tåsi Leon Guerrero-Santos' }))
    expect(screen.getByText('All caught up.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Show a load failure' }))
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load approvals.")
  })
})
