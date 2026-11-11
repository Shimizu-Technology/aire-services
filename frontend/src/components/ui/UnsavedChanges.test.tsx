import '@testing-library/jest-dom'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createMemoryRouter, Link, MemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ShellChromeProvider } from '../layouts/ShellChromeContext'
import { useShellChrome } from '../layouts/shellChrome'
import { UnsavedChangesBar } from './UnsavedChangesBar'
import { useUnsavedChanges } from './useUnsavedChanges'

function TabBarProbe() {
  return <p>{useShellChrome().selectionBarActive ? 'tab bar hidden' : 'tab bar shown'}</p>
}

function ApprovalSettings({ onSave = vi.fn(), onDiscard = vi.fn(), report }: { onSave?: () => void; onDiscard?: () => void; report?: (blocks: boolean) => void }) {
  const [saved, setSaved] = useState('Off')
  const [draft, setDraft] = useState('Off')
  const dirty = draft !== saved
  const { guard, blocksNavigation } = useUnsavedChanges({ dirty, what: 'Approvals', onDiscard })
  report?.(blocksNavigation)
  return (
    <>
      <label>Auto-approve <input value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
      <Link to="/admin/settings">Settings</Link>
      <Link to="/admin/settings/approvals#help">Help</Link>
      <UnsavedChangesBar
        dirty={dirty}
        summary={`Auto-approve: ${saved} → ${draft}`}
        onSave={() => { onSave(); setSaved(draft) }}
        onDiscard={() => setDraft(saved)}
      />
      {guard}
    </>
  )
}

function renderWithDataRouter(props: Parameters<typeof ApprovalSettings>[0] = {}) {
  const router = createMemoryRouter([
    { path: '/admin/settings/approvals', element: <ShellChromeProvider><TabBarProbe /><ApprovalSettings {...props} /></ShellChromeProvider> },
    { path: '/admin/settings', element: <p>Settings home</p> },
  ], { initialEntries: ['/admin/settings/approvals'] })
  render(<RouterProvider router={router} />)
  return router
}

describe('UnsavedChangesBar', () => {
  it('appears with the change, takes the tab bar slot, and saves or discards', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    renderWithDataRouter({ onSave })
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).not.toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Auto-approve' }), 'n')
    const bar = screen.getByRole('region', { name: 'Unsaved changes' })
    expect(bar).toHaveTextContent('Unsaved change')
    expect(bar).toHaveTextContent('Auto-approve: Off → Offn')
    expect(screen.getByText('You have unsaved changes')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByText('tab bar hidden')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.getByRole('textbox')).toHaveValue('Off')
    expect(screen.getByText('tab bar shown')).toBeInTheDocument()

    await user.type(screen.getByRole('textbox'), '!')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).not.toBeInTheDocument()
  })
})

describe('useUnsavedChanges', () => {
  it('blocks navigation, then Keep editing stays and Discard changes leaves', async () => {
    const user = userEvent.setup()
    const onDiscard = vi.fn()
    const router = renderWithDataRouter({ onDiscard })
    await user.type(screen.getByRole('textbox', { name: 'Auto-approve' }), 'n')

    await user.click(screen.getByRole('link', { name: 'Settings' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Leave without saving?' })
    expect(dialog).toHaveAccessibleDescription('Your changes to Approvals will be lost.')
    expect(screen.getByRole('button', { name: 'Keep editing' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/admin/settings/approvals')
    expect(screen.getByRole('textbox')).toHaveValue('Offn')

    await user.click(screen.getByRole('link', { name: 'Settings' }))
    await user.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(onDiscard).toHaveBeenCalledTimes(1)
    expect(router.state.location.pathname).toBe('/admin/settings')
    expect(screen.getByText('Settings home')).toBeInTheDocument()
  })

  it("doesn't ask when nothing changed or only the hash moves", async () => {
    const user = userEvent.setup()
    const router = renderWithDataRouter()
    await user.click(screen.getByRole('link', { name: 'Help' }))
    expect(router.state.location.hash).toBe('#help')
    await user.type(screen.getByRole('textbox'), 'n')
    await user.click(screen.getByRole('link', { name: 'Help' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await act(async () => { await router.navigate('/admin/settings') })
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('asks before the tab closes while there are changes', async () => {
    const user = userEvent.setup()
    renderWithDataRouter()
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)
    await user.type(screen.getByRole('textbox'), 'n')
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
  })

  it('says when the router cannot block in-app navigation', () => {
    const report = vi.fn()
    render(<MemoryRouter><ApprovalSettings report={report} /></MemoryRouter>)
    expect(report).toHaveBeenLastCalledWith(false)
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })
})
