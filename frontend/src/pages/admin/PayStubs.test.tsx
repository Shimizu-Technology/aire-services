import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import PayStubs from './PayStubs'
import type { PayStubLink, PayStubRequest } from '../../lib/payStubsApi'

const api = vi.hoisted(() => ({
  workers: vi.fn(), worker: vi.fn(), statements: vi.fn(), requests: vi.fn(), dismiss: vi.fn(), links: vi.fn(), send: vi.fn(), revoke: vi.fn(),
  notificationEmails: vi.fn(), updateNotificationEmails: vi.fn(),
}))
vi.mock('../../lib/payStubsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/payStubsApi')>()
  return { ...actual, payStubsApi: api }
})
const caps = vi.hoisted(() => ({ preview_pay: true }))
vi.mock('../../lib/useCapabilities', () => ({ useCapabilities: () => caps }))

const worker = { id: 9, name: 'Mindy Cruz', first_name: 'Mindy', role: 'employee' as const, on_file_email: 'mindy@example.com' }
const request: PayStubRequest = {
  id: 3, status: 'open', source: 'kiosk', scope: 'year', statement_id: null, pay_date: null, year: 2026, worker,
  recipient_kind: 'typed', recipient_email: 'mindy.home@example.com', can_send: true, requested_at: '2026-11-10T02:00:00Z',
  resolved_at: null, resolved_by: null, resolution_note: null, links: [],
}
// What a manager gets: the address on file masked, and no run purpose.
const managerWorker = { ...worker, on_file_email: 'm•••@example.com' }
const onFileRequest: PayStubRequest = { ...request, id: 4, scope: 'latest', year: null, worker: managerWorker, recipient_kind: 'on_file', recipient_email: 'm•••@example.com', can_send: true }
const statements = [
  { id: '42', pay_date: '2026-11-15', period_start: '2026-10-26', period_end: '2026-11-08', run_purpose: 'regular', voided: false },
  { id: '41', pay_date: '2026-10-31', period_start: '2026-10-12', period_end: '2026-10-25', run_purpose: 'regular', voided: true },
  { id: '40', pay_date: '2026-10-15', period_start: '2026-09-28', period_end: '2026-10-11', run_purpose: 'regular', voided: false },
  { id: '30', pay_date: '2025-12-31', period_start: '2025-12-14', period_end: '2025-12-27', run_purpose: 'regular', voided: false },
]
const link: PayStubLink = {
  id: 5, state: 'active', origin: 'sender', worker: { id: 9, name: 'Mindy Cruz' }, sent_by: 'Roke Manager', recipient_email: 'mindy.home@example.com',
  recipient_kind: 'typed', request_id: 3, sent_at: '2026-11-10T03:00:00Z', expires_at: '2026-11-17T03:00:00Z', revoked_at: null, revoked_by: null,
  max_downloads_per_document: 5, documents: [{ id: 1, pay_date: '2026-11-15', period_start: null, period_end: null, downloads_used: 2 }],
}

function renderPage(path = '/admin/pay-stubs') {
  return render(<MemoryRouter initialEntries={[path]}><PayStubs /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  caps.preview_pay = true
  api.requests.mockImplementation((status: string) => Promise.resolve(status === 'open' ? { requests: [request], open_count: 1 } : { requests: [], open_count: 1 }))
  api.notificationEmails.mockResolvedValue({ emails: [], editable: false })
  api.statements.mockResolvedValue({ statements })
  api.workers.mockResolvedValue({ workers: [worker] })
  api.links.mockResolvedValue({ links: [link] })
  api.send.mockResolvedValue({ link, email_status: 'sent' })
  api.revoke.mockResolvedValue({ link: { ...link, state: 'revoked', revoked_by: 'Roke Manager' } })
})

it('lists a kiosk request with who, what and where, and no amounts', async () => {
  renderPage()
  const card = (await screen.findByText('Mindy Cruz')).closest('li') as HTMLElement
  expect(within(card).getByText('All 2026 pay stubs')).toBeInTheDocument()
  expect(within(card).getByText('mindy.home@example.com')).toBeInTheDocument()
  expect(within(card).getByText(/typed at the kiosk/)).toBeInTheDocument()
  expect(within(card).getByText('Not the email on file')).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'Requests (1)' })).toBeInTheDocument()
  expect(screen.getByText(/Nobody is emailed now/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Change recipients' })).not.toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(/\$\d/)
})

it('lets an admin fulfil a year request with that year\'s unvoided stubs, to the address from the request', async () => {
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: 'Send' }))
  const dialog = await screen.findByRole('dialog', { name: 'Send a pay stub' })
  await within(dialog).findByText('Oct 15, 2026')
  const boxes = within(dialog).getAllByRole('checkbox') as HTMLInputElement[]
  expect(boxes.map((box) => box.checked)).toEqual([true, false, true, false])
  expect(boxes[1]).toBeDisabled()
  expect(within(dialog).getByText("Voided, can't be sent")).toBeInTheDocument()
  expect(within(dialog).getByText('Not the email on file')).toBeInTheDocument()
  // The address comes from the request; it can't be edited here.
  expect(within(dialog).queryByLabelText('Email')).not.toBeInTheDocument()
  expect(within(dialog).getByText(/Sends 2 pay stubs to/)).toBeInTheDocument()

  fireEvent.click(within(dialog).getByRole('button', { name: 'Send secure link' }))
  await waitFor(() => expect(api.send).toHaveBeenCalledWith({ userId: 9, statementIds: ['42', '40'], requestId: 3 }))
  expect(await within(dialog).findByText('We emailed a secure link to mindy.home@example.com.')).toBeInTheDocument()
})

it('leaves a request to a typed address for an owner or admin when a manager is signed in', async () => {
  caps.preview_pay = false
  api.requests.mockImplementation((status: string) => Promise.resolve(status === 'open'
    ? { requests: [{ ...request, worker: managerWorker, can_send: false }], open_count: 1 }
    : { requests: [], open_count: 1 }))
  renderPage()
  const card = (await screen.findByText('Mindy Cruz')).closest('li') as HTMLElement
  expect(within(card).getByText('Not the email on file')).toBeInTheDocument()
  expect(within(card).getByText('An owner or admin needs to send this one.')).toBeInTheDocument()
  expect(within(card).queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
  expect(within(card).getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
})

it('shows a manager only the masked email on file, with no way to type another', async () => {
  caps.preview_pay = false
  api.workers.mockResolvedValue({ workers: [managerWorker], can_choose_recipient: false })
  api.statements.mockResolvedValue({ statements: statements.map((row) => ({ ...row, run_purpose: undefined })) })
  api.send.mockResolvedValue({ link: { ...link, recipient_kind: 'on_file', recipient_email: 'm•••@example.com' }, email_status: 'sent' })
  renderPage('/admin/pay-stubs?send=9')
  const dialog = await screen.findByRole('dialog', { name: 'Send a pay stub' })
  await within(dialog).findByText('Nov 15, 2026')

  expect(within(dialog).getByText('m•••@example.com (email on file)')).toBeInTheDocument()
  expect(within(dialog).queryByRole('radio')).not.toBeInTheDocument()
  expect(within(dialog).queryByLabelText('Email')).not.toBeInTheDocument()
  expect(dialog.textContent).not.toContain('mindy@example.com')

  fireEvent.click(within(dialog).getByRole('button', { name: 'Send secure link' }))
  await waitFor(() => expect(api.send).toHaveBeenCalledWith({ userId: 9, statementIds: ['42'], requestId: null }))
  expect(await within(dialog).findByText('We emailed a secure link to m•••@example.com.')).toBeInTheDocument()
})

it('lets a manager fulfil a request for the email on file', async () => {
  caps.preview_pay = false
  api.requests.mockImplementation((status: string) => Promise.resolve(status === 'open' ? { requests: [onFileRequest], open_count: 1 } : { requests: [], open_count: 1 }))
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: 'Send' }))
  const dialog = await screen.findByRole('dialog', { name: 'Send a pay stub' })
  await within(dialog).findByText('Nov 15, 2026')
  expect(within(dialog).getByText('m•••@example.com (email on file)')).toBeInTheDocument()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Send secure link' }))
  await waitFor(() => expect(api.send).toHaveBeenCalledWith({ userId: 9, statementIds: ['42'], requestId: 4 }))
})

it('says no email is on file to a manager and can\'t send', async () => {
  caps.preview_pay = false
  api.workers.mockResolvedValue({ workers: [{ ...managerWorker, on_file_email: null }], can_choose_recipient: false })
  renderPage('/admin/pay-stubs?send=9')
  const dialog = await screen.findByRole('dialog', { name: 'Send a pay stub' })
  await within(dialog).findByText('Nov 15, 2026')
  expect(within(dialog).getByText(/There's no email on file for Mindy/)).toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: 'Send secure link' })).toBeDisabled()
})

it('shows the heads-up list read-only, pointing owners and admins to Settings', async () => {
  api.notificationEmails.mockResolvedValue({ emails: ['office@example.com'], editable: true })
  renderPage()
  expect(await screen.findByText(/New requests are also emailed to office@example.com/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Change recipients in Settings' })).toHaveAttribute('href', '/admin/settings#pay-stubs')
})

it('starts a send for the person in the link and defaults to their email on file', async () => {
  renderPage('/admin/pay-stubs?send=9')
  const dialog = await screen.findByRole('dialog', { name: 'Send a pay stub' })
  await within(dialog).findByText('Nov 15, 2026')
  expect(within(dialog).getByRole('combobox', { name: 'Person' })).toHaveValue('9')
  expect((within(dialog).getAllByRole('checkbox') as HTMLInputElement[]).filter((box) => box.checked)).toHaveLength(1)
  expect(within(dialog).getByRole('radio', { name: /Email on file/ })).toBeChecked()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Send secure link' }))
  await waitFor(() => expect(api.send).toHaveBeenCalledWith({ userId: 9, statementIds: ['42'], requestId: null }))
})

it('dismisses a request with a note', async () => {
  api.dismiss.mockResolvedValue({ request: { ...request, status: 'dismissed' } })
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))
  fireEvent.change(screen.getByLabelText(/Note/), { target: { value: 'Printed a copy' } })
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss request' }))
  await waitFor(() => expect(api.dismiss).toHaveBeenCalledWith(3, 'Printed a copy'))
  await waitFor(() => expect(api.requests).toHaveBeenCalledTimes(4))
})

it('revokes a sent link after confirming', async () => {
  renderPage('/admin/pay-stubs?tab=links')
  expect(await screen.findByText('To mindy.home@example.com')).toBeInTheDocument()
  expect(screen.getByText(/Downloaded 2 times/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
  fireEvent.click(screen.getByRole('button', { name: 'Revoke link' }))
  await waitFor(() => expect(api.revoke).toHaveBeenCalledWith(5))
  expect(await screen.findByText('Revoked')).toBeInTheDocument()
})
