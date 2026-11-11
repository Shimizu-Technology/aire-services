import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useDialogFocus } from '../../lib/useDialogFocus'
import { ConfirmDialog } from './ConfirmDialog'
import { useConfirm, type ConfirmOptions } from './useConfirm'

function renderDialog(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  const view = render(
    <ConfirmDialog open title="Delete this shift?" description="It's removed from the schedule." confirmLabel="Delete shift"
      onConfirm={onConfirm} onCancel={onCancel} {...props} />,
  )
  return { ...view, onConfirm, onCancel }
}

describe('ConfirmDialog', () => {
  it('renders nothing while closed', () => {
    render(<ConfirmDialog open={false} title="Hidden" confirmLabel="Go" onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('is a labelled, described modal alert dialog in a portal', () => {
    renderDialog({ details: <p>Shift: Tue 7:00 AM</p> })
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this shift?' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription(/It's removed from the schedule\.\s*Shift: Tue 7:00 AM/)
    expect(dialog.parentElement?.parentElement).toBe(document.body)
  })

  it('focuses the action for an ordinary confirmation and Cancel for a destructive one', () => {
    const { unmount } = renderDialog()
    expect(screen.getByRole('button', { name: 'Delete shift' })).toHaveFocus()
    unmount()
    renderDialog({ tone: 'danger' })
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Delete shift' })).toHaveClass('bg-danger')
  })

  it('confirms and cancels with the buttons', async () => {
    const user = userEvent.setup()
    const { onConfirm, onCancel } = renderDialog()
    await user.click(screen.getByRole('button', { name: 'Delete shift' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('cancels on Escape and on a backdrop tap, but not while busy', async () => {
    const user = userEvent.setup()
    const { onCancel, rerender, onConfirm } = renderDialog()
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('alertdialog').parentElement!)
    expect(onCancel).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('alertdialog'))
    expect(onCancel).toHaveBeenCalledTimes(2)

    rerender(<ConfirmDialog open busy title="Delete this shift?" confirmLabel="Delete shift" onConfirm={onConfirm} onCancel={onCancel} />)
    await user.keyboard('{Escape}')
    fireEvent.click(screen.getByRole('alertdialog').parentElement!)
    expect(onCancel).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Delete shift' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })

  it('traps Tab and Shift+Tab inside the dialog', async () => {
    const user = userEvent.setup()
    render(<button type="button">Outside</button>)
    renderDialog()
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const action = screen.getByRole('button', { name: 'Delete shift' })
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 100, 44)] as unknown as DOMRectList)
    try {
      expect(action).toHaveFocus()
      await user.tab()
      expect(cancel).toHaveFocus()
      await user.tab({ shift: true })
      expect(action).toHaveFocus()
      await user.tab({ shift: true })
      expect(cancel).toHaveFocus()
    } finally { vi.restoreAllMocks() }
  })

  it('returns focus to the control that opened it', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Delete</button>
          <ConfirmDialog open={open} title="Delete?" confirmLabel="Delete" onConfirm={() => setOpen(false)} onCancel={() => setOpen(false)} />
        </>
      )
    }
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Delete' })
    await user.click(trigger)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('can require typed confirmation', async () => {
    const user = userEvent.setup()
    const { onConfirm } = renderDialog({ tone: 'danger', requireText: 'DELETE' })
    const input = screen.getByLabelText(/Type DELETE to confirm/)
    expect(input).toHaveFocus()
    const action = screen.getByRole('button', { name: 'Delete shift' })
    expect(action).toBeDisabled()
    await user.type(input, 'DELE')
    expect(action).toBeDisabled()
    await user.type(input, 'TE')
    expect(action).toBeEnabled()
    await user.click(action)
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('lays out as a bottom-anchored card with full-width buttons on phones', () => {
    renderDialog()
    expect(screen.getByRole('alertdialog').parentElement).toHaveClass('items-end', 'sm:items-center')
    expect(screen.getByRole('button', { name: 'Delete shift' })).toHaveClass('w-full', 'sm:w-auto', 'min-h-11')
  })

  it('handles Escape only for the top dialog when opened over another dialog', async () => {
    const user = userEvent.setup()
    const onModalClose = vi.fn()
    function Modal() {
      const ref = useRef<HTMLDivElement>(null)
      const [confirming, setConfirming] = useState(false)
      useDialogFocus(true, ref, onModalClose)
      return (
        <div ref={ref} role="dialog" aria-label="Edit shift">
          <button type="button" onClick={() => setConfirming(true)}>Delete</button>
          <ConfirmDialog open={confirming} tone="danger" title="Delete?" confirmLabel="Delete shift" onConfirm={vi.fn()} onCancel={() => setConfirming(false)} />
        </div>
      )
    }
    render(<Modal />)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onModalClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(onModalClose).toHaveBeenCalledOnce()
  })
})

describe('useConfirm', () => {
  function Harness({ options, onResult }: { options: ConfirmOptions; onResult: (value: boolean) => void }) {
    const [confirm, dialog] = useConfirm()
    return (
      <>
        <button type="button" onClick={async () => onResult(await confirm(options))}>Ask</button>
        {dialog}
      </>
    )
  }

  it('resolves true on confirm and false on cancel or Escape', async () => {
    const user = userEvent.setup()
    const onResult = vi.fn()
    render(<Harness options={{ title: 'Approve 3 entries?', confirmLabel: 'Approve 3 entries' }} onResult={onResult} />)

    await user.click(screen.getByRole('button', { name: 'Ask' }))
    await user.click(screen.getByRole('button', { name: 'Approve 3 entries' }))
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(true))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Ask' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(false))

    await user.click(screen.getByRole('button', { name: 'Ask' }))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(3))
    expect(onResult).toHaveBeenLastCalledWith(false)
  })

  it('defaults the action label and resolves false if the page unmounts mid-question', async () => {
    const onResult = vi.fn()
    const view = render(<Harness options={{ title: 'Continue?' }} onResult={onResult} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    expect(await screen.findByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    view.unmount()
    await act(async () => {})
    expect(onResult).toHaveBeenCalledWith(false)
  })
})
