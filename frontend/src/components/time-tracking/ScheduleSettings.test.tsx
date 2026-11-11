import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ScheduleSettings from './ScheduleSettings'
import type { TimeClockAppSettings } from '../../lib/api'

const mocks = vi.hoisted(() => ({ updateAdminAppSettings: vi.fn(), refreshCurrentUser: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: { updateAdminAppSettings: mocks.updateAdminAppSettings } }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ refreshCurrentUser: mocks.refreshCurrentUser }) }))

const off = { schedules_enabled: 'false', schedule_required_for_clock_in: 'false' } as unknown as TimeClockAppSettings
const on = { ...off, schedules_enabled: 'true' } as unknown as TimeClockAppSettings

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

describe('ScheduleSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.updateAdminAppSettings.mockResolvedValue({ data: { settings: on } })
  })

  it('says the menu changed only after the profile refresh finishes', async () => {
    const refresh = deferred<boolean>()
    mocks.refreshCurrentUser.mockReturnValue(refresh.promise)
    const onSaved = vi.fn()
    render(<ScheduleSettings settings={off} onSaved={onSaved} />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Use schedules' }))
    await waitFor(() => expect(mocks.refreshCurrentUser).toHaveBeenCalledWith({ background: true }))
    expect(onSaved).toHaveBeenCalledWith(on)
    expect(screen.queryByText(/menu/, { selector: '[role="status"]' })).not.toBeInTheDocument()

    await act(async () => refresh.resolve(true))
    expect(screen.getByText('Schedule is now in everyone’s menu.')).toHaveAttribute('role', 'status')
  })

  it.each([
    ['resolves without a profile', () => Promise.resolve(false)],
    ['rejects', () => Promise.reject(new Error('offline'))],
  ])('says the menu will catch up when the refresh %s', async (_label, refresh) => {
    mocks.refreshCurrentUser.mockImplementation(refresh)
    render(<ScheduleSettings settings={off} onSaved={vi.fn()} />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Use schedules' }))
    expect(await screen.findByText('Saved. Schedule will appear in the menu shortly.')).toHaveAttribute('role', 'status')
    expect(screen.queryByText('Schedule is now in everyone’s menu.')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
