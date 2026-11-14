import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, Link, RouterProvider, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminUser } from '../../lib/api'
import { ToastProvider } from '../ui'
import { mockMatchMedia } from '../../test/matchMedia'
import { AccessTab } from './AccessTab'
import { EmploymentTab } from './EmploymentTab'
import { EndEmploymentFlow } from './EndEmploymentFlow'

const mocks = vi.hoisted(() => ({ save: vi.fn(), person: vi.fn(), preview: vi.fn(), terminate: vi.fn(), reactivate: vi.fn(), settings: vi.fn(), categories: vi.fn(), resend: vi.fn() }))
vi.mock('../../lib/api/people', () => ({ peopleApi: { save: mocks.save, person: mocks.person, terminationPreview: mocks.preview, terminate: mocks.terminate, reactivate: mocks.reactivate } }))
vi.mock('../../lib/api', () => ({ api: { getAdminAppSettings: mocks.settings, getAdminTimeCategories: mocks.categories, resendInvite: mocks.resend } }))
const auth = vi.hoisted(() => ({ value: { currentUser: { id: 99 }, userRole: 'admin' } }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => auth.value }))

const person = {
  id: 7, admin_edit_version: 4, email: 'ana@aire.test', first_name: 'Ana', last_name: 'Rivera', full_name: 'Ana Rivera', display_name: 'Ana Rivera',
  role: 'employee', assignable_roles: ['employee', 'manager'], can_change_access: true, is_active: true, personal_access_enabled: true, has_clerk_account: true,
  employment_status: 'active', staff_title: 'Instructor', is_intern: false, time_tracking_enabled: true, kiosk_enabled: true, kiosk_pin_configured: true,
  approval_group_keys: ['cfi'], time_category_ids: [1], time_categories: [{ id: 1, name: 'Instruction', key: 'instruction' }],
  my_pay_enabled: false, public_team_enabled: false, public_team_name: null, public_team_title: null, public_team_sort_order: 0,
  public_team_photo_position_x: 50, public_team_photo_position_y: 50,
} as AdminUser
const preview = { admin_edit_version: 4, waiting_shifts: 1, waiting_hours: 11.5, waiting_overtime_hours: 6, open_clock: false, open_pay_stub_links: 2, open_pay_stub_requests: 0, open_leave_requests: 1 }
let restoreMedia = () => {}
const onSaved = vi.fn()
function Address() { const location = useLocation(); return <output aria-label="Address">{location.pathname}{location.search}</output> }
function open(element: React.ReactNode) {
  return render(<ToastProvider><RouterProvider router={createMemoryRouter([{ path: '*', element: <>{element}<Link to="?tab=employment">Other tab</Link><Address /></> }], { initialEntries: ['/admin/users/7?tab=access'] })} /></ToastProvider>)
}
function access(user = person) {
  return open(<AccessTab user={user} myPayForEveryone={false} myPayError={null} onDelete={vi.fn()} onResetPin={vi.fn()} onSaved={onSaved} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-14T02:00:00Z'))
  restoreMedia = mockMatchMedia({ width: 1280 })
  auth.value = { currentUser: { id: 99 }, userRole: 'admin' }
  mocks.settings.mockResolvedValue({ data: { approval_groups: [{ key: 'cfi', label: 'CFI' }, { key: 'ops', label: 'Operations' }] } })
  mocks.categories.mockResolvedValue({ data: { time_categories: [{ id: 1, name: 'Instruction', is_active: true }, { id: 2, name: 'Ground', is_active: true }] } })
  mocks.save.mockResolvedValue({ data: { user: { ...person, admin_edit_version: 5 } } })
  mocks.preview.mockResolvedValue({ data: { preview } })
  mocks.terminate.mockResolvedValue({ data: { user: { ...person, employment_status: 'terminated', admin_edit_version: 5 } } })
  mocks.reactivate.mockResolvedValue({ data: { user: person } })
})
afterEach(() => { restoreMedia(); vi.useRealTimers() })

describe('Access', () => {
  it('saves role and My Pay together with the loaded version and names the role change', async () => {
    access()
    fireEvent.click(screen.getByRole('radio', { name: /^Manager/ }))
    fireEvent.click(screen.getByRole('switch', { name: 'My Pay' }))
    expect(screen.getByRole('region', { name: 'Unsaved changes' })).toHaveTextContent('Role: Employee → Manager')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(7, expect.objectContaining({ admin_edit_version: 4, role: 'manager', my_pay_enabled: true }), undefined))
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ admin_edit_version: 5 }), undefined)
  })
  it('shows Admin unavailable and hides Owner for admins; owners may select both', () => {
    const rendered = access()
    expect(screen.getByRole('radio', { name: /^Admin/ })).toBeDisabled()
    expect(screen.queryByRole('radio', { name: /^Owner/ })).not.toBeInTheDocument()
    rendered.unmount()
    auth.value.userRole = 'owner'
    access({ ...person, assignable_roles: ['employee', 'manager', 'admin', 'owner'] })
    expect(screen.getByRole('radio', { name: /^Admin/ })).toBeEnabled()
    expect(screen.getByRole('radio', { name: /^Owner/ })).toBeEnabled()
  })
  it('explains self role and sign-in restrictions', () => {
    auth.value.currentUser.id = 7
    access({ ...person, assignable_roles: [] })
    expect(screen.getByText("You can't change your own role.")).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /^Manager/ })).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'Personal sign-in' })).toBeDisabled()
  })
  it('keeps the draft on a 409, prevents stale retry and offers reload', async () => {
    mocks.save.mockResolvedValue({ error: 'Someone else changed this person since you opened it. Nothing was saved. Reload to see their changes.', status: 409 })
    mocks.person.mockResolvedValue({ data: { user: { ...person, role: 'admin', admin_edit_version: 5 } } })
    access()
    fireEvent.click(screen.getByRole('radio', { name: /^Manager/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was saved.')
    expect(screen.getByRole('radio', { name: /^Manager/ })).toBeChecked()
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Reload person' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin', admin_edit_version: 5 })))
  })
  it('guards tab navigation, keeps the draft, then discards it on request', async () => {
    access()
    fireEvent.click(screen.getByRole('radio', { name: /^Manager/ }))
    fireEvent.click(screen.getByRole('link', { name: 'Other tab' }))
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Leave without saving?' })).getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByLabelText('Address')).toHaveTextContent('tab=access')
    expect(screen.getByRole('radio', { name: /^Manager/ })).toBeChecked()
    fireEvent.click(screen.getByRole('link', { name: 'Other tab' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard changes' }))
    await waitFor(() => expect(screen.getByLabelText('Address')).toHaveTextContent('tab=employment'))
    expect(screen.getByRole('radio', { name: /^Employee/ })).toBeChecked()
  })
})

describe('Employment', () => {
  it('collects work setup and website changes into one versioned save', async () => {
    open(<EmploymentTab user={person} onSaved={onSaved} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Job title' }), { target: { value: 'Senior instructor' } })
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Operations' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ground' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Intern' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit profile' }))
    const sheet = screen.getByRole('dialog', { name: 'Website profile' })
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Bio' }), { target: { value: 'Flight instructor based in Guam.' } })
    fireEvent.change(within(sheet).getByRole('spinbutton', { name: 'Display order' }), { target: { value: '3' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }))
    expect(mocks.save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(7, expect.objectContaining({ admin_edit_version: 4,
      staff_title: 'Senior instructor', approval_groups: ['cfi', 'ops'], time_category_ids: [1, 2], is_intern: true,
      public_team_bio: 'Flight instructor based in Guam.', public_team_sort_order: 3 }), null))
  })
  it('rejects an oversized photo without losing other draft changes', () => {
    open(<EmploymentTab user={person} onSaved={onSaved} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Job title' }), { target: { value: 'Retained title' } })
    fireEvent.click(screen.getByRole('button', { name: 'Edit profile' }))
    const file = new File(['tiny'], 'portrait.png', { type: 'image/png' })
    Object.defineProperty(file, 'size', { value: 16 * 1024 * 1024 })
    fireEvent.change(screen.getByLabelText('Photo'), { target: { files: [file] } })
    expect(screen.getByRole('alert')).toHaveTextContent('smaller than 15 MB')
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByRole('textbox', { name: 'Job title' })).toHaveValue('Retained title')
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('reactivates with the loaded version and preserves the new PIN response', async () => {
    mocks.reactivate.mockResolvedValue({ data: { user: person, kiosk_pin: '123456' } })
    open(<EmploymentTab user={{ ...person, employment_status: 'terminated', is_active: false, termination_effective_on: '2026-11-11', terminated_by: { id: 2, full_name: 'Chels Santos' } }} onSaved={onSaved} />)
    expect(screen.getByText(/Employment ended .* by Chels Santos/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reactivate…' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Reactivate' }))
    await waitFor(() => expect(mocks.reactivate).toHaveBeenCalledWith(7, 4))
    expect(onSaved).toHaveBeenCalledWith(person, '123456')
  })
})

describe('End employment', () => {
  it('requires the full name before submitting date and version', async () => {
    const close = vi.fn()
    open(<EndEmploymentFlow user={person} onClose={close} onEnded={onSaved} />)
    const dialog = screen.getByRole('alertdialog')
    await within(dialog).findByText('Not clocked in right now.')
    const confirm = within(dialog).getByRole('button', { name: 'End employment' })
    expect(confirm).toBeDisabled()
    expect(dialog).toHaveTextContent('2 open pay stub links are revoked.')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Type Ana Rivera to confirm' }), { target: { value: 'Ana' } })
    expect(confirm).toBeDisabled()
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Type Ana Rivera to confirm' }), { target: { value: 'Ana Rivera' } })
    fireEvent.click(confirm)
    await waitFor(() => expect(mocks.terminate).toHaveBeenCalledWith(7, { admin_edit_version: 4, effective_on: '2026-11-14', confirm_name: 'Ana Rivera', reason: undefined }))
    expect(close).toHaveBeenCalled()
  })
  it('blocks an open clock even after the full name is typed', async () => {
    mocks.preview.mockResolvedValue({ data: { preview: { ...preview, open_clock: true } } })
    open(<EndEmploymentFlow user={person} onClose={vi.fn()} onEnded={onSaved} />)
    await screen.findByText('Clocked in right now: clock them out first.')
    fireEvent.change(screen.getByRole('textbox', { name: 'Type Ana Rivera to confirm' }), { target: { value: 'Ana Rivera' } })
    expect(screen.getByRole('button', { name: 'End employment' })).toBeDisabled()
    expect(mocks.terminate).not.toHaveBeenCalled()
  })
  it('fails closed when the preview fails or its version changed', async () => {
    mocks.preview.mockResolvedValue({ error: 'Connection lost' })
    const rendered = open(<EndEmploymentFlow user={person} onClose={vi.fn()} onEnded={onSaved} />)
    await screen.findByText('Connection lost')
    expect(screen.getByRole('button', { name: 'End employment' })).toBeDisabled()
    rendered.unmount()
    mocks.preview.mockResolvedValue({ data: { preview: { ...preview, admin_edit_version: 5 } } })
    open(<EndEmploymentFlow user={person} onClose={vi.fn()} onEnded={onSaved} />)
    await screen.findByText(/This person changed/)
    expect(screen.getByRole('button', { name: 'End employment' })).toBeDisabled()
  })
  it('uses a phone sheet with full-name confirmation', async () => {
    restoreMedia(); restoreMedia = mockMatchMedia({ width: 390 })
    open(<EndEmploymentFlow user={person} onClose={vi.fn()} onEnded={onSaved} />)
    expect(screen.getByRole('dialog', { name: "End Ana Rivera's employment" })).toBeInTheDocument()
    await screen.findByText('Not clocked in right now.')
    expect(screen.getByRole('button', { name: 'End employment' })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Type Ana Rivera to confirm' }), { target: { value: 'Ana Rivera' } })
    expect(screen.getByRole('button', { name: 'End employment' })).toBeEnabled()
  })
})
