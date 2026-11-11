import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AutoApprovalSettings from './AutoApprovalSettings'
import type { TimeClockAppSettings } from '../../lib/api'

const apiMock = vi.hoisted(() => ({ updateAdminAppSettings: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: apiMock }))

const base = { auto_approve_ordinary_shifts: 'false', auto_approve_max_shift_hours: '12' } as TimeClockAppSettings

function renderSettings(settings: TimeClockAppSettings = base) {
  const onSaved = vi.fn()
  render(<AutoApprovalSettings settings={settings} onSaved={onSaved} />)
  return onSaved
}

describe('AutoApprovalSettings', () => {
  beforeEach(() => {
    apiMock.updateAdminAppSettings.mockReset()
    apiMock.updateAdminAppSettings.mockImplementation(async ({ settings }) => ({ data: { settings: { ...base, ...settings }, approval_groups: [] } }))
  })

  it('starts off and explains the rule, the default and who can change it', () => {
    renderSettings()

    const toggle = screen.getByRole('checkbox', { name: 'Auto-approve ordinary shifts' })
    expect(toggle).not.toBeChecked()
    expect(toggle).toHaveAccessibleDescription(/Employees only. Overtime is never auto-approved/)

    fireEvent.click(screen.getByRole('button', { name: 'About Auto-approve ordinary shifts' }))
    const tip = screen.getAllByText(/Chels and the CEO must agree/)[0]
    expect(tip).toBeInTheDocument()
    expect(screen.getAllByText('Owners and admins').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/her shift shows Auto-approved/).length).toBeGreaterThan(0)
  })

  it('asks for confirmation before turning it on, and saves nothing on cancel', async () => {
    renderSettings()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Auto-approve ordinary shifts' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Chels and the CEO must agree')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(apiMock.updateAdminAppSettings).not.toHaveBeenCalled()
  })

  it('turns it on after confirmation and reports the saved state', async () => {
    const onSaved = renderSettings()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Auto-approve ordinary shifts' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Turn on' }))

    await waitFor(() => expect(apiMock.updateAdminAppSettings).toHaveBeenCalledWith({ settings: { auto_approve_ordinary_shifts: 'true' } }))
    expect(await screen.findByText('Ordinary shifts are now approved at clock-out.')).toBeInTheDocument()
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ auto_approve_ordinary_shifts: 'true' }))
  })

  it('turns it off without a confirmation', async () => {
    renderSettings({ ...base, auto_approve_ordinary_shifts: 'true' })

    fireEvent.click(screen.getByRole('checkbox', { name: 'Auto-approve ordinary shifts' }))

    await waitFor(() => expect(apiMock.updateAdminAppSettings).toHaveBeenCalledWith({ settings: { auto_approve_ordinary_shifts: 'false' } }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('saves a new shift-length limit and rejects one out of range', async () => {
    renderSettings()

    const input = screen.getByLabelText('Longest shift to auto-approve (hours)')
    fireEvent.change(input, { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save limit' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('from 1 to 23')
    expect(apiMock.updateAdminAppSettings).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save limit' }))
    await waitFor(() => expect(apiMock.updateAdminAppSettings).toHaveBeenCalledWith({ settings: { auto_approve_max_shift_hours: '10' } }))
    expect(await screen.findByText('Shifts of 10 hours or longer go to the queue.')).toBeInTheDocument()
  })

  it('shows the save error and leaves the switch as it was', async () => {
    apiMock.updateAdminAppSettings.mockResolvedValue({ error: 'Only owners and admins can change settings' })
    renderSettings({ ...base, auto_approve_ordinary_shifts: 'true' })

    fireEvent.click(screen.getByRole('checkbox', { name: 'Auto-approve ordinary shifts' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Only owners and admins can change settings')
    expect(screen.getByRole('checkbox', { name: 'Auto-approve ordinary shifts' })).toBeChecked()
  })
})
