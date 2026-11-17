import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Plus, Trash2 } from 'lucide-react'
import { Button, IconButton } from './Button'
import { buttonClasses } from './buttonStyles'

describe('Button', () => {
  it('is a non-submitting button in the brand primary by default', () => {
    render(<form><Button>Save</Button></form>)
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveClass('bg-primary', 'text-white')
    expect(button).not.toHaveClass('bg-slate-950')
  })

  it.each([
    ['secondary', 'border-line-strong'],
    ['danger', 'bg-danger'],
    ['danger-outline', 'text-danger'],
    ['ghost', 'text-primary'],
  ] as const)('styles the %s variant', (variant, expected) => {
    render(<Button variant={variant}>Go</Button>)
    expect(screen.getByRole('button', { name: 'Go' })).toHaveClass(expected)
  })

  it('keeps every size at least 44px on touch screens', () => {
    for (const size of ['sm', 'md', 'lg'] as const) {
      const classes = buttonClasses({ size }).split(' ')
      expect(classes.some(name => name === 'min-h-11' || name === 'min-h-12')).toBe(true)
    }
    // Compact desktop controls retain 44px minimums for touch.
    expect(buttonClasses({ size: 'sm' })).toContain('pointer-fine:min-h-9')
    expect(buttonClasses({ iconOnly: true })).toContain('size-11')
  })

  it('allows a detailed action to grow without a fixed height or nowrap label', () => {
    render(<Button layout="detail">Reject change, keep original time<span>7:00 AM–1:20 PM</span></Button>)
    const button = screen.getByRole('button', { name: /Reject change, keep original time/ })
    expect(button).toHaveTextContent('7:00 AM–1:20 PM')
    expect(button).toHaveClass('flex-col', 'max-w-full', 'whitespace-normal')
    expect(button).not.toHaveClass('h-11', 'h-12', 'whitespace-nowrap')
  })

  it('activates from the keyboard', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Approve</Button>)
    await user.tab()
    expect(screen.getByRole('button', { name: 'Approve' })).toHaveFocus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('shows loading as busy and disabled while keeping its name', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const { rerender } = render(<Button loading onClick={onClick} icon={<Plus />}>Save</Button>)
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    await user.click(button)
    expect(onClick).not.toHaveBeenCalled()
    rerender(<Button loading loadingLabel="Saving…">Save</Button>)
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    rerender(<Button>Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).not.toHaveAttribute('aria-busy')
  })

  it('submits when asked to', () => {
    render(<Button type="submit">Send</Button>)
    expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('type', 'submit')
  })
})

describe('IconButton', () => {
  it('requires a label for its accessible name and tooltip', () => {
    render(<IconButton label="Delete entry" icon={<Trash2 />} variant="danger-outline" />)
    const button = screen.getByRole('button', { name: 'Delete entry' })
    expect(button).toHaveAttribute('title', 'Delete entry')
    expect(button.querySelector('svg')?.closest('[aria-hidden="true"]')).not.toBeNull()
  })
})
