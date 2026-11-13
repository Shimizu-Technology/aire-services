import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import { approvalsApi } from '../../lib/api/approvals'
import { ToastProvider } from '../../components/ui'
import Approvals from './Approvals'
import { reviewEntry } from '../../test/approvalFixtures'
const auth = vi.hoisted(() => ({ currentUser: { id: 10, approval_group: 'cfi' }, isClerkEnabled: true, userRole: 'manager' }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => auth }))
vi.mock('../../lib/api', () => ({ api: { getUsers: vi.fn(), getTimeCategories: vi.fn(), getPayrollCutoff: vi.fn(), getLeaveRequests: vi.fn(), getWhosWorking: vi.fn() } }))
vi.mock('../../lib/api/approvals', () => ({ approvalsApi: { pending: vi.fn(), review: vi.fn(), undo: vi.fn() } }))
vi.mock('../../lib/payStubsApi', () => ({ payStubsApi: { requests: vi.fn().mockResolvedValue({ requests: [] }) } }))
vi.mock('./TimeTracking', () => ({ default: ({ section }: { section: string }) => <p>Classic queue: {section}</p> }))
const row = reviewEntry
const rows = [row(1, 1), row(2, 1), row(3, 2), row(4, 2, { review_kind: 'needs_look', exceptions: [{ key: 'overtime', label: 'Overtime' }], overtime_status: 'pending' }), row(5, 10, { review_kind: 'needs_look', needs_another_approver: true, exceptions: [{ key: 'needs_another_approver', label: 'Needs another approver' }] })]
const response = () => ({ data: { pending_entries: rows, count: 5, review_summary: { complete: true, batch_limit: 100, ordinary_count: 3, ordinary_hours: 24, needs_look_count: 2, by_person: [] }, pagination: { current_page: 1, total_pages: 1, total_count: 5 } } })
const renderInbox = (url = '/admin/approvals') => render(<MemoryRouter initialEntries={[url]}><ToastProvider><Approvals /></ToastProvider></MemoryRouter>)
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  vi.mocked(api.getUsers).mockResolvedValue({ data: { users: [], approval_groups: [{ key: 'cfi', label: 'CFI' }, { key: 'ops', label: 'Ops/Maint' }] } })
  vi.mocked(api.getTimeCategories).mockResolvedValue({ data: { time_categories: [] } })
  vi.mocked(api.getPayrollCutoff).mockResolvedValue({ error: 'No published period' })
  vi.mocked(api.getLeaveRequests).mockResolvedValue({ data: { leave_requests: [], pagination: { current_page: 1, per_page: 100, total_count: 0, total_pages: 1 } } })
  vi.mocked(api.getWhosWorking).mockResolvedValue({ data: { workers: [] } })
  vi.mocked(approvalsApi.pending).mockResolvedValue(response())
  vi.mocked(approvalsApi.review).mockResolvedValue({ data: { review_batch_id: 'one', undo_expires_at: '2026-11-14T00:00:00Z', approved_count: 2, time_entries: [] } })
})
describe('Approvals inbox', () => {
  it('approves exactly the displayed person group, excluding overtime and own time', async () => {
    renderInbox(); await screen.findByText('Ordinary shifts · 3 · 24.0h')
    fireEvent.click(screen.getByRole('button', { name: 'Approve 2 shifts for Marcus Quinata' }))
    await waitFor(() => expect(approvalsApi.review).toHaveBeenCalledOnce())
    expect(vi.mocked(approvalsApi.review).mock.calls[0][0]).toEqual([{ id: 1, version: 11, approve_time: true, approve_overtime: false }, { id: 2, version: 12, approve_time: true, approve_overtime: false }])
    expect(screen.getByText('Needs another approver')).toBeInTheDocument()
  })
  it('confirms all using the same snapshot, naming exclusions', async () => {
    renderInbox(); fireEvent.click(await screen.findByRole('button', { name: 'Approve all 3' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('Overtime'); expect(dialog).toHaveTextContent('Needs another approver')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve 3 shifts' }))
    await waitFor(() => expect(approvalsApi.review).toHaveBeenCalledOnce())
    expect(vi.mocked(approvalsApi.review).mock.calls[0][0].map(item => [item.id, item.version])).toEqual([[1, 11], [2, 12], [3, 13]])
  })
  it('supports roving rows, Space, Enter, Esc, Shift+A confirm and no single-key approve', async () => {
    const user = userEvent.setup(); renderInbox(); await screen.findByText('Ordinary shifts · 3 · 24.0h')
    const list = screen.getByRole('list', { name: 'Ordinary shifts by person' })
    const first = list.querySelector<HTMLElement>('[data-list-row]')!; first.focus()
    await user.keyboard('{Enter}'); expect(screen.getAllByRole('checkbox', { name: 'Select Marcus Quinata, 2026-11-10' })).toHaveLength(2)
    await user.keyboard(' '); expect(screen.getByRole('region', { name: 'Selected shifts' })).toHaveTextContent('2 shifts')
    await user.keyboard('a'); expect(approvalsApi.review).not.toHaveBeenCalled()
    await user.keyboard('{Shift>}a{/Shift}'); expect(screen.getByRole('alertdialog')).toHaveTextContent('Approve 2 shifts?')
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    first.focus(); await user.keyboard('{Escape}'); expect(screen.queryByRole('region', { name: 'Selected shifts' })).not.toBeInTheDocument()
    first.focus(); await user.keyboard('j'); expect(document.activeElement?.textContent).toContain('Nov')
  })
  it('confirms a cross-person selection and sends exactly those rows', async () => {
    renderInbox(); await screen.findByText('Ordinary shifts · 3 · 24.0h')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Marcus Quinata' })); fireEvent.click(screen.getByRole('checkbox', { name: 'Select Grace Torres' }))
    fireEvent.click(within(screen.getByRole('region', { name: 'Selected shifts' })).getByRole('button', { name: 'Approve 3' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Approve 3 shifts' }))
    await waitFor(() => expect(approvalsApi.review).toHaveBeenCalledOnce())
    expect(vi.mocked(approvalsApi.review).mock.calls[0][0].map(item => item.id)).toEqual([1, 2, 3])
  })
  it('disables saving while offline with the reason', async () => {
    renderInbox(); await screen.findByText('Ordinary shifts · 3 · 24.0h')
    act(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }); window.dispatchEvent(new Event('offline')) })
    expect(screen.getByRole('button', { name: 'Approve all 3' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Approve all 3' })).toHaveAttribute('title', 'Reconnect to approve')
  })
  it('renders the unchanged classic route element', async () => { renderInbox('/admin/approvals?classic=1'); expect(await screen.findByText('Classic queue: approvals')).toBeInTheDocument(); expect(approvalsApi.pending).not.toHaveBeenCalled() })
})
