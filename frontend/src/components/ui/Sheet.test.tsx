import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Sheet } from './Sheet'

function Harness({ onClose = vi.fn() }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  const close = () => { onClose(); setOpen(false) }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Filters</button>
      <Sheet open={open} onClose={close} title="Filters" description="Narrow the approvals list." footer={<button type="button" onClick={close}>Done</button>}>
        <label htmlFor="employee">Employee</label>
        <select id="employee"><option>Everyone</option></select>
      </Sheet>
    </>
  )
}

describe('Sheet', () => {
  it('opens as a labelled modal dialog and focuses its first control', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Filters' }))
    const sheet = screen.getByRole('dialog', { name: 'Filters' })
    expect(sheet).toHaveAttribute('aria-modal', 'true')
    expect(sheet).toHaveAccessibleDescription('Narrow the approvals list.')
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('is a bottom sheet on phones and a side panel from 768px', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Filters' }))
    const sheet = screen.getByRole('dialog')
    expect(sheet).toHaveClass('rounded-t-card', 'max-h-[85dvh]', 'md:h-dvh', 'md:max-w-md')
    expect(sheet.parentElement).toHaveClass('items-end', 'md:justify-end')
  })

  it('closes on Escape, the close button and a backdrop tap, returning focus', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    const trigger = screen.getByRole('button', { name: 'Filters' })

    await user.click(trigger)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(trigger)
    fireEvent.mouseDown(screen.getByRole('dialog'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('keeps Tab inside the sheet', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Filters' }))
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 100, 44)] as unknown as DOMRectList)
    try {
      const close = screen.getByRole('button', { name: 'Close' })
      const done = screen.getByRole('button', { name: 'Done' })
      done.focus()
      await user.tab()
      expect(close).toHaveFocus()
      await user.tab({ shift: true })
      expect(done).toHaveFocus()
    } finally { vi.restoreAllMocks() }
  })
})
