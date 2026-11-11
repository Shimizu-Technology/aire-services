import '@testing-library/jest-dom'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ShellChromeProvider } from '../layouts/ShellChromeContext'
import { useShellChrome } from '../layouts/shellChrome'
import { Button } from './Button'
import { SelectionBar } from './SelectionBar'

function ShellProbe() {
  const { selectionBarActive } = useShellChrome()
  return <p>{selectionBarActive ? 'tab bar hidden' : 'tab bar shown'}</p>
}

function Harness({ initial = 0 }: { initial?: number }) {
  const [count, setCount] = useState(initial)
  return (
    <ShellChromeProvider>
      <ShellProbe />
      <button type="button" onClick={() => setCount(value => value + 1)}>Select a shift</button>
      <input aria-label="Search" />
      <SelectionBar
        count={count}
        noun={['shift', 'shifts']}
        summary="2 people · 35.4h"
        label="Selected shifts"
        onClear={() => setCount(0)}
        actions={<Button>{`Approve ${count}`}</Button>}
      />
    </ShellChromeProvider>
  )
}

describe('SelectionBar', () => {
  it('stays out of the way until something is selected', () => {
    render(<Harness />)
    expect(screen.queryByRole('region', { name: 'Selected shifts' })).not.toBeInTheDocument()
    expect(screen.getByText('tab bar shown')).toBeInTheDocument()
  })

  it('shows a live count and summary, and hides the tab bar while showing', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Select a shift' }))
    const bar = screen.getByRole('region', { name: 'Selected shifts' })
    expect(bar).toHaveAccessibleDescription('1 shift selected')
    expect(screen.getByText('1 shift selected')).toHaveAttribute('aria-live', 'polite')
    expect(bar).toHaveTextContent('1 shift')
    expect(bar).toHaveTextContent('2 people · 35.4h')
    expect(screen.getByText('tab bar hidden')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Select a shift' }))
    expect(screen.getByText('2 shifts selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve 2' })).toBeInTheDocument()
  })

  it('clears with Clear and gives focus back to the page', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const select = screen.getByRole('button', { name: 'Select a shift' })
    await user.click(select)
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.queryByRole('region', { name: 'Selected shifts' })).not.toBeInTheDocument()
    expect(screen.getByText('tab bar shown')).toBeInTheDocument()
    expect(select).toHaveFocus()
    expect(screen.getByText('Selection cleared')).toHaveAttribute('aria-live', 'polite')
  })

  it('says nothing at 0 before anything was selected', () => {
    const { container } = render(<Harness />)
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent(/^$/)
  })

  it('clears on Escape, but not while typing in a field', async () => {
    const user = userEvent.setup()
    render(<Harness initial={3} />)
    await user.click(screen.getByRole('textbox', { name: 'Search' }))
    await user.keyboard('{Escape}')
    expect(screen.getByRole('region', { name: 'Selected shifts' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Approve 3' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('region', { name: 'Selected shifts' })).not.toBeInTheDocument()
  })

  it('keeps the tab bar hidden until every bar is gone', () => {
    function Two({ first, second }: { first: number; second: number }) {
      return (
        <ShellChromeProvider>
          <ShellProbe />
          <SelectionBar count={first} onClear={vi.fn()} actions={null} label="One" />
          <SelectionBar count={second} onClear={vi.fn()} actions={null} label="Two" />
        </ShellChromeProvider>
      )
    }
    const { rerender, unmount } = render(<Two first={1} second={1} />)
    act(() => rerender(<Two first={0} second={1} />))
    expect(screen.getByText('tab bar hidden')).toBeInTheDocument()
    act(() => rerender(<Two first={0} second={0} />))
    expect(screen.getByText('tab bar shown')).toBeInTheDocument()
    unmount()
  })

  it('sits where the tab bar was on phones, above the home indicator, and sticks to the content on desktop', () => {
    render(<Harness initial={1} />)
    const bar = screen.getByRole('region', { name: 'Selected shifts' })
    expect(bar).toHaveClass('fixed', 'bottom-0', 'pb-safe-3', 'z-(--z-tabbar)', 'shadow-raised', 'lg:sticky')
    // Every button in the bar is a 44px touch target.
    for (const button of Array.from(bar.querySelectorAll('button'))) expect(button.className).toMatch(/min-h-11/)
  })
})
