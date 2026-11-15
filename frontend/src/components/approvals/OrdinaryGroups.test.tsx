import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import OrdinaryGroups from './OrdinaryGroups'
import { reviewEntry } from '../../test/approvalFixtures'

afterEach(() => vi.restoreAllMocks())
it.each([false, true])('moves focus only after completed approval: %s', async completed => {
  let frame: FrameRequestCallback | undefined
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frame = callback; return 1 })
  render(<OrdinaryGroups rows={[reviewEntry(1, 1), reviewEntry(2, 2)]} groupBy="person" selected={new Set()} onSelect={vi.fn()} onApprove={vi.fn().mockResolvedValue(completed)} disabled={false} />)
  const buttons = screen.getAllByRole('button', { name: /^Approve/ })
  buttons[0].focus()
  await act(async () => { fireEvent.click(buttons[0]) })
  if (completed) {
    act(() => frame?.(0))
    expect(buttons[1]).toHaveFocus()
  } else {
    expect(frame).toBeUndefined()
    expect(buttons[0]).toHaveFocus()
  }
})
it.each(['dialog', 'alertdialog'])('never moves focus behind an open %s', async role => {
  let frame: FrameRequestCallback | undefined
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frame = callback; return 1 })
  render(<><OrdinaryGroups rows={[reviewEntry(1, 1), reviewEntry(2, 2)]} groupBy="person" selected={new Set()} onSelect={vi.fn()} onApprove={vi.fn().mockResolvedValue(true)} disabled={false} /><div role={role}><button>Dialog control</button></div></>)
  await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /^Approve/ })[0]) })
  screen.getByRole('button', { name: 'Dialog control' }).focus()
  act(() => frame?.(0))
  expect(screen.getByRole('button', { name: 'Dialog control' })).toHaveFocus()
})
