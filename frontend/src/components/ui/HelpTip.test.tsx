import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HelpTip } from './HelpTip'

const structured = (
  <HelpTip
    label="Early clock-in buffer"
    what="How early someone can clock in before a scheduled shift."
    defaultValue="5 minutes"
    who="Owners and admins"
    example="At 5, a 7:00 AM shift opens at 6:55 AM."
  />
)

function bubble() {
  return document.body.querySelector<HTMLElement>('[id$="-tip"]')
}

describe('HelpTip', () => {
  afterEach(() => vi.restoreAllMocks())

  it('is a named toggle button that starts closed', () => {
    render(structured)
    const button = screen.getByRole('button', { name: 'About Early clock-in buffer' })
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    expect(bubble()).toBeNull()
  })

  it('opens on tap and announces the four structured lines', async () => {
    const user = userEvent.setup()
    render(structured)
    const button = screen.getByRole('button', { name: 'About Early clock-in buffer' })
    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(button).toHaveAttribute('aria-controls', bubble()?.id)
    const status = screen.getByRole('status')
    for (const text of ['What it does', 'How early someone can clock in', 'Default', '5 minutes', 'Who can change it', 'Owners and admins', 'Example', '6:55 AM']) {
      expect(status).toHaveTextContent(text)
      expect(bubble()).toHaveTextContent(text)
    }
    // The visible copy isn't read a second time.
    expect(bubble()).toHaveAttribute('aria-hidden', 'true')
    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(bubble()).toBeNull()
  })

  it('opens from the keyboard with Enter or Space and closes on Escape, keeping focus', async () => {
    const user = userEvent.setup()
    render(structured)
    await user.tab()
    const button = screen.getByRole('button', { name: 'About Early clock-in buffer' })
    expect(button).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(button).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{Escape}')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveFocus()
    await user.keyboard(' ')
    expect(button).toHaveAttribute('aria-expanded', 'true')
  })

  it('does not open on hover', async () => {
    const user = userEvent.setup()
    render(structured)
    await user.hover(screen.getByRole('button'))
    expect(bubble()).toBeNull()
  })

  it('closes on an outside tap but not a tap inside the tip', async () => {
    const user = userEvent.setup()
    render(<><p>Outside</p>{structured}</>)
    await user.click(screen.getByRole('button', { name: /About/ }))
    fireEvent.pointerDown(bubble()!)
    expect(bubble()).not.toBeNull()
    fireEvent.pointerDown(screen.getByText('Outside'))
    expect(bubble()).toBeNull()
  })

  it('closes when focus moves to another control', async () => {
    const user = userEvent.setup()
    render(<>{structured}<button type="button">Save</button></>)
    await user.click(screen.getByRole('button', { name: /About/ }))
    await user.tab()
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus()
    expect(bubble()).toBeNull()
  })

  it('stops Escape from also closing a dialog it sits in', async () => {
    const user = userEvent.setup()
    const dialogEscape = vi.fn()
    document.addEventListener('keydown', dialogEscape, true)
    try {
      render(structured)
      await user.click(screen.getByRole('button', { name: /About/ }))
      await user.keyboard('{Escape}')
      expect(dialogEscape).not.toHaveBeenCalled()
      await user.keyboard('{Escape}')
      expect(dialogEscape).toHaveBeenCalledOnce()
    } finally { document.removeEventListener('keydown', dialogEscape, true) }
  })

  it.each([
    ['near the right edge', 370, 386],
    ['near the left edge', 4, 20],
  ])('stays inside a 390px viewport when the button is %s', async (_where, left, right) => {
    const user = userEvent.setup()
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(390)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(844)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(304)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(180)
    render(structured)
    const button = screen.getByRole('button', { name: /About/ })
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(left, 300, right - left, 16))
    await user.click(button)
    const tip = bubble()!
    const tipLeft = Number.parseFloat(tip.style.left)
    expect(tipLeft).toBeGreaterThanOrEqual(8)
    expect(tipLeft + 304).toBeLessThanOrEqual(390 - 8)
    expect(tip.style.top).toBe('324px')
    expect(tip.dataset.side).toBe('bottom')
    expect(tip).toHaveClass('max-w-[min(20rem,calc(100vw-1rem))]')
  })

  it('flips above the button when there is no room below', async () => {
    const user = userEvent.setup()
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(390)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(844)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(180)
    render(structured)
    const button = screen.getByRole('button', { name: /About/ })
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(180, 800, 16, 16))
    await user.click(button)
    expect(bubble()!.dataset.side).toBe('top')
    expect(bubble()!.style.top).toBe(`${800 - 8 - 180}px`)
  })

  it('accepts free-form content and has a 44px hit area', async () => {
    const user = userEvent.setup()
    render(<HelpTip label="Approve day">Approves every ordinary shift for that day.</HelpTip>)
    const button = screen.getByRole('button', { name: 'About Approve day' })
    expect(button).toHaveClass('size-6', 'after:-inset-2.5')
    await user.click(button)
    expect(screen.getByRole('status')).toHaveTextContent('Approve day. Approves every ordinary shift for that day.')
  })
})
