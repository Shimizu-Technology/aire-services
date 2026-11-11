import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockMatchMedia } from '../../test/matchMedia'
import { ConfirmDialog } from './ConfirmDialog'
import { Menu, type MenuItem } from './Menu'
import { Sheet } from './Sheet'

let restore = () => undefined as void
afterEach(() => restore())

function items(onSelect = vi.fn()): MenuItem[] {
  return [
    { id: 'person', label: 'Open person page', onSelect: () => onSelect('person') },
    { id: 'pin', label: 'Reset kiosk PIN', onSelect: () => onSelect('pin'), disabled: true },
    { id: 'stub', label: 'Send stub', onSelect: () => onSelect('stub') },
  ]
}

describe('Menu', () => {
  it('is a popover menu from 1024px with arrow keys, skipping disabled items', async () => {
    restore = mockMatchMedia({ width: 1280 })
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<Menu label="More actions for Caleb Perez" items={items(onSelect)} />)
    const trigger = screen.getByRole('button', { name: 'More actions for Caleb Perez' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')

    await user.click(trigger)
    const menu = screen.getByRole('menu', { name: 'More actions for Caleb Perez' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Open person page' })).toHaveFocus()
    expect(screen.getByRole('menuitem', { name: 'Reset kiosk PIN' })).toHaveAttribute('aria-disabled', 'true')
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Send stub' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Open person page' })).toHaveFocus()
    await user.keyboard('{End}{Enter}')
    expect(onSelect).toHaveBeenCalledWith('stub')
    expect(menu).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes on Escape and an outside click', async () => {
    restore = mockMatchMedia({ width: 1280 })
    const user = userEvent.setup()
    render(<><p>Outside</p><Menu label="More actions" items={items()} /></>)
    const trigger = screen.getByRole('button', { name: 'More actions' })
    await user.click(trigger)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    await user.click(screen.getByText('Outside'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes itself on Escape inside a Sheet, leaving the sheet open until the next Escape', async () => {
    restore = mockMatchMedia({ width: 1280 })
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Sheet open onClose={onClose} title="Caleb Perez"><Menu label="More actions for Caleb Perez" items={items()} /></Sheet>)
    const trigger = screen.getByRole('button', { name: 'More actions for Caleb Perez' })
    await user.click(trigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(trigger).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does the same inside a ConfirmDialog', async () => {
    restore = mockMatchMedia({ width: 1280 })
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog open title="Send stubs?" confirmLabel="Send" details={<Menu label="Options" items={items()} />} onConfirm={vi.fn()} onCancel={onCancel} />,
    )
    await user.click(screen.getByRole('button', { name: 'Options' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('becomes a sheet under 1024px', async () => {
    restore = mockMatchMedia({ width: 390 })
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<Menu label="More actions for Caleb Perez" title="Caleb Perez" items={items(onSelect)} />)
    const trigger = screen.getByRole('button', { name: 'More actions for Caleb Perez' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    await user.click(trigger)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    const sheet = screen.getByRole('dialog', { name: 'Caleb Perez' })
    expect(sheet).toHaveClass('rounded-t-card')
    const send = screen.getByRole('button', { name: 'Send stub' })
    expect(send).toHaveClass('min-h-12')
    expect(screen.getByRole('button', { name: 'Reset kiosk PIN' })).toBeDisabled()
    await user.click(send)
    expect(onSelect).toHaveBeenCalledWith('stub')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps 44px targets for touch on the trigger and desktop items', async () => {
    restore = mockMatchMedia({ width: 1280 })
    const user = userEvent.setup()
    render(<Menu label="More actions" items={items()} />)
    expect(screen.getByRole('button', { name: 'More actions' })).toHaveClass('size-11')
    await user.click(screen.getByRole('button', { name: 'More actions' }))
    for (const item of screen.getAllByRole('menuitem')) expect(item).toHaveClass('min-h-11', 'pointer-fine:min-h-9')
  })
})
