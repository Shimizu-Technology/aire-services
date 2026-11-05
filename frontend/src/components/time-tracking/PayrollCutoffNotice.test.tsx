import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LATE_HOURS_NOTICE } from '../../lib/payrollCutoffCopy'
import PayrollCutoffNotice from './PayrollCutoffNotice'
import { api } from '../../lib/api'

const auth = vi.hoisted(() => ({ role: 'employee', id: 1 }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ userRole: auth.role, isClerkEnabled: true, currentUser: { id: auth.id } }) }))
vi.mock('../../lib/api', () => ({ api: { getPayrollCutoff: vi.fn(), acknowledgePayrollCutoff: vi.fn(), getPendingApprovals: vi.fn() } }))
const cutoff = { period: { id: 7, start_date: '2026-10-16', end_date: '2026-10-31' }, publication_id: 'pub-1', version: 1, now: '2026-11-06T14:00:00Z', cutoff_at: '2026-11-07T17:00:00+10:00', seconds_remaining: 61200, time_zone: 'Pacific/Guam', stage: '24h' as const }
function mount() { return render(<MemoryRouter><PayrollCutoffNotice /></MemoryRouter>) }

describe('Payroll cutoff notice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    vi.mocked(api.getPendingApprovals).mockResolvedValue({ data: { count: 0 } } as Awaited<ReturnType<typeof api.getPendingApprovals>>)
    auth.role = 'employee'
    auth.id = 1
    vi.mocked(api.getPayrollCutoff).mockResolvedValue({ data: { cutoff, acknowledged: false } })
    vi.mocked(api.acknowledgePayrollCutoff).mockResolvedValue({ data: { acknowledged: true } })
  })
  it('shows paused guidance and read-only attention without calendar setup, reminders or acknowledgement', async () => {
    auth.role = 'admin'
    vi.mocked(api.getPayrollCutoff).mockResolvedValue({ data: { cutoff, attention: { period: cutoff.period, lock_mode: 'scheduled', cutoff_state: 'attention_required' }, connected_payroll: { mode: 'paused', enabled: false, message: 'Connected payroll is paused' } } })
    mount()
    expect(await screen.findByRole('region', { name: 'Payroll connection paused' })).toHaveTextContent('Payroll connection is paused. Time tracking and approvals work normally; Cornerstone processes payroll from the hours report.')
    expect(screen.queryByRole('link', { name: 'Set up the payroll calendar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Payroll attention' })).toHaveTextContent('Payroll needs attention')
    expect(api.acknowledgePayrollCutoff).not.toHaveBeenCalled()
  })

  it.each(['paused', 'enabled'] as const)('uses a fresh kiosk %s capability instead of the opposite shared cache', async mode => {
    const enabled = mode === 'enabled'
    sessionStorage.setItem('aire:last-payroll-cutoff', JSON.stringify({ cutoff, connected_payroll: { mode: enabled ? 'paused' : 'enabled', enabled: !enabled, message: null } }))
    vi.mocked(api.getPayrollCutoff).mockResolvedValue({ error: 'Offline' })
    render(<MemoryRouter><PayrollCutoffNotice kiosk={{ accessToken: 'access', employeeToken: 'employee', sessionKey: 'fresh', notice: { cutoff, acknowledged: false, connected_payroll: { mode, enabled, message: enabled ? null : 'Connected payroll is paused' } } }} /></MemoryRouter>)
    if (enabled) {
      expect(await screen.findByRole('dialog')).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Payroll connection paused' })).not.toBeInTheDocument()
    } else {
      expect(await screen.findByRole('region', { name: 'Payroll connection paused' })).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    }
  })

  it('honors a newer live pause after an earlier enabled kiosk action', async () => {
    vi.mocked(api.getPayrollCutoff).mockResolvedValue({ data: { cutoff: { ...cutoff, now: '2026-11-06T14:01:00Z' }, connected_payroll: { mode: 'paused', enabled: false, message: 'Connected payroll is paused' } } })
    render(<MemoryRouter><PayrollCutoffNotice kiosk={{ accessToken: 'access', employeeToken: 'employee', sessionKey: 'fresh', notice: { cutoff, acknowledged: false, connected_payroll: { mode: 'enabled', enabled: true, message: null } } }} /></MemoryRouter>)
    await screen.findByRole('region', { name: 'Payroll connection paused' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('retains paused guidance when a later refresh fails', async () => {
    vi.mocked(api.getPayrollCutoff).mockResolvedValue({ data: { cutoff: { ...cutoff, period: null, stage: 'none' }, connected_payroll: { mode: 'paused', enabled: false, message: 'Connected payroll is paused' } } })
    const view = mount()
    await screen.findByRole('region', { name: 'Payroll connection paused' })
    view.unmount()
    vi.mocked(api.getPayrollCutoff).mockResolvedValue({ error: 'Offline' })
    mount()
    expect(await screen.findByRole('region', { name: 'Payroll connection paused' })).toBeInTheDocument()
    expect(screen.queryByText('Set up the payroll calendar')).not.toBeInTheDocument()
  })

  it('uses the server Guam date, exposes a named dialog and keeps the banner after Escape', async () => {
    mount()
    const dialog = await screen.findByRole('dialog', { name: /hours lock today/i })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveTextContent('ChST (UTC+10)')
    expect(within(dialog).getByRole('link', { name: 'Review my hours' })).toHaveAttribute('href', '/admin/time?start_date=2026-10-16&end_date=2026-10-31&tab=entries&view=period')
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Got it' })).toHaveFocus())
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('region', { name: 'Payroll cutoff' })).toBeInTheDocument()
    expect(api.acknowledgePayrollCutoff).toHaveBeenCalledOnce()
  })
  it('links both the banner and popup to the entire locked period', async () => {
    mount()
    await screen.findByRole('dialog')
    const links = screen.getAllByRole('link', { name: 'Review my hours' })
    expect(links).toHaveLength(2)
    for (const link of links) expect(link).toHaveAttribute('href', '/admin/time?start_date=2026-10-16&end_date=2026-10-31&tab=entries&view=period')
  })

  it('gives managers period-review instructions and a popup approval action', async () => {
    auth.role = 'admin'
    mount()
    const dialog = await screen.findByRole('dialog')
    expect(dialog).not.toHaveTextContent('contact your manager')
    expect(screen.getByRole('region', { name: 'Payroll cutoff' })).not.toHaveTextContent('contact your manager')
    expect(dialog).toHaveTextContent('Review this period’s hours and pending approvals before then.')
    expect(within(dialog).getByRole('link', { name: 'Review pending approvals' })).toHaveAttribute('href', '/admin/time?start_date=2026-10-16&end_date=2026-10-31&tab=approvals')
    expect(within(dialog).getByRole('link', { name: 'Review period hours' })).toBeInTheDocument()
  })

  it('preserves employee instructions and keeps manager actions private', async () => {
    mount()
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Review your hours and contact your manager about anything missing before then.')
    expect(screen.queryByRole('link', { name: 'Review pending approvals' })).not.toBeInTheDocument()
  })

  it('honors a server acknowledgement from another device', async () => {
    vi.mocked(api.getPayrollCutoff).mockResolvedValue({ data: { cutoff, acknowledged: true } })
    mount()
    await screen.findByRole('region', { name: 'Payroll cutoff' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('keeps the absolute cutoff marked stale when refresh fails, without another dialog', async () => {
    mount()
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    vi.mocked(api.getPayrollCutoff).mockResolvedValue({ error: 'Offline' })
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(await screen.findByText(/last known cutoff/i)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText(/November 7, 2026/)).toBeInTheDocument()
  })
  it('a new 4h stage opens once, but passed states do not open a dialog', async () => {
    mount()
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    vi.mocked(api.getPayrollCutoff).mockResolvedValue({ data: { cutoff: { ...cutoff, stage: '4h' }, acknowledged: false } })
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    await screen.findByRole('dialog')
    vi.mocked(api.getPayrollCutoff).mockResolvedValue({ data: { cutoff: { ...cutoff, stage: 'passed' }, acknowledged: false } })
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText(LATE_HOURS_NOTICE)).toBeInTheDocument()
  })
  it('does not show anything to employees without a published scheduled period', async () => {
    vi.mocked(api.getPayrollCutoff).mockResolvedValue({ data: { cutoff: { ...cutoff, period: null, stage: 'none' } } })
    mount()
    await waitFor(() => expect(api.getPayrollCutoff).toHaveBeenCalled())
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('refreshes on visibility and completed actions, without duplicate stage dialogs', async () => {
    mount()
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('aire:clock-action')) })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.getPayrollCutoff).toHaveBeenCalledTimes(3)
  })
  it('isolates kiosk sessions and does not open a new stage during an ongoing clock action', async () => {
    const initial = { cutoff, acknowledged: false }
    const view = render(<MemoryRouter><PayrollCutoffNotice kiosk={{ accessToken: 'access', employeeToken: 'employee-a', sessionKey: 'a', notice: initial }} /></MemoryRouter>)
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    vi.mocked(api.getPayrollCutoff).mockResolvedValue({ data: { cutoff: { ...cutoff, stage: '4h' } } })
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    view.rerender(<MemoryRouter><PayrollCutoffNotice kiosk={{ accessToken: 'access', employeeToken: 'employee-b', sessionKey: 'b', notice: { cutoff: { ...cutoff, stage: '4h' }, acknowledged: false } }} /></MemoryRouter>)
    await screen.findByRole('dialog')
    expect(api.acknowledgePayrollCutoff).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ employeeToken: 'employee-a' }))
  })

  it('retains the safe absolute cutoff through an offline reload without a dialog', async () => {
    const view = mount()
    await screen.findByRole('dialog')
    view.unmount()
    vi.mocked(api.getPayrollCutoff).mockResolvedValue({ error: 'Offline' })
    mount()
    expect(await screen.findByText(/Last known cutoff/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not offer calendar setup before the connection capability is confirmed', async () => {
    auth.role = 'admin'
    vi.mocked(api.getPayrollCutoff).mockResolvedValue({ data: { cutoff: { ...cutoff, period: null, stage: 'none' } } })
    await act(async () => { mount() })
    expect(api.getPayrollCutoff).toHaveBeenCalled()
    expect(screen.queryByRole('link', { name: 'Set up the payroll calendar' })).not.toBeInTheDocument()
  })

  it('gives admins a setup notice without inventing an employee cutoff', async () => {
    auth.role = 'admin'
    vi.mocked(api.getPendingApprovals).mockResolvedValue({ data: { pending_entries: [], count: 0 } })
    vi.mocked(api.getPayrollCutoff).mockResolvedValue({ data: { connected_payroll: { mode: 'enabled', enabled: true, message: null }, cutoff: { ...cutoff, period: null, stage: 'none' } } })
    mount()
    expect(await screen.findByRole('region', { name: 'Payroll cutoff setup' })).toHaveTextContent('No scheduled payroll cutoff is published')
  })
  it('adds the admin pending count and approvals link', async () => {
    auth.role = 'admin'
    vi.mocked(api.getPendingApprovals).mockResolvedValue({ data: { pending_entries: [], count: 1 } })
    vi.mocked(api.getPayrollCutoff).mockResolvedValue({ data: { cutoff, acknowledged: true } })
    mount()
    expect(await screen.findByRole('link', { name: '1 pending approval' })).toHaveAttribute('href', '/admin/time?start_date=2026-10-16&end_date=2026-10-31&tab=approvals')
    expect(api.getPendingApprovals).toHaveBeenCalledWith({ per_page: 1, start_date: '2026-10-16', end_date: '2026-10-31' })
  })

  it('marks a kiosk notice stale and removes relative date copy when refresh fails', async () => {
    vi.mocked(api.getPayrollCutoff).mockResolvedValue({ error: 'Offline' })
    render(<MemoryRouter><PayrollCutoffNotice kiosk={{ accessToken: 'access', employeeToken: 'employee', sessionKey: 'a', notice: { cutoff, acknowledged: false } }} /></MemoryRouter>)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Last known cutoff/)).toBeInTheDocument()
    expect(dialog).not.toHaveTextContent('hours lock today')
    expect(dialog).toHaveTextContent('November 7, 2026')
  })

  it('revalidates the acknowledgement when a different personal account signs in', async () => {
    vi.mocked(api.getPayrollCutoff).mockResolvedValue({ data: { cutoff, acknowledged: true } })
    const view = mount()
    await screen.findByRole('region', { name: 'Payroll cutoff' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    auth.id = 2
    vi.mocked(api.getPayrollCutoff).mockResolvedValue({ data: { cutoff, acknowledged: false } })
    view.rerender(<MemoryRouter><PayrollCutoffNotice /></MemoryRouter>)
    await screen.findByRole('dialog')
  })

  it.each(['personal', 'kiosk'])('does not label a cached %s cutoff stale while the first refresh is pending', async audience => {
    sessionStorage.setItem('aire:last-payroll-cutoff', JSON.stringify(cutoff))
    let finish!: (value: Awaited<ReturnType<typeof api.getPayrollCutoff>>) => void
    vi.mocked(api.getPayrollCutoff).mockReturnValue(new Promise(resolve => { finish = resolve }))
    render(<MemoryRouter><PayrollCutoffNotice kiosk={audience === 'kiosk' ? { accessToken: 'access', employeeToken: '', sessionKey: 'shared', notice: null } : undefined} /></MemoryRouter>)
    expect(screen.getByRole('region', { name: 'Payroll cutoff' })).toHaveTextContent('November 7, 2026')
    expect(screen.queryByText(/unable to refresh/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await act(async () => { finish({ error: 'Offline' }) })
    expect(screen.getByText(/unable to refresh/i)).toBeInTheDocument()
  })

  it('starts keyboard focus on Got it while keeping Close available', async () => {
    mount()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Got it' })).toHaveFocus()
    expect(within(dialog).getByRole('button', { name: 'Close payroll cutoff notice' })).toBeVisible()
  })

  it('shows admins a failed manual lock attention notice without an employee countdown', async () => {
    auth.role = 'admin'
    vi.mocked(api.getPendingApprovals).mockResolvedValue({ data: { pending_entries: [], count: 0 } })
    const data = { cutoff: { ...cutoff, period: null, stage: 'none' as const }, attention: { period: { id: 8, start_date: '2026-10-01', end_date: '2026-10-15' }, lock_mode: 'manual' as const, cutoff_state: 'attention_required' as const } }
    vi.mocked(api.getPayrollCutoff).mockResolvedValue({ data })
    mount()
    const notice = await screen.findByRole('region', { name: 'Payroll attention' })
    expect(notice).toHaveTextContent('October 1–15')
    expect(notice).toHaveTextContent('manual payroll lock did not complete')
    expect(within(notice).getByRole('link', { name: 'Review payroll status' })).toHaveAttribute('href', '/admin/payroll')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText(/hours lock/)).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Payroll cutoff setup' })).not.toBeInTheDocument()
  })

})
