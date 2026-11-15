import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { PayStubsStep } from './PayStubsStep'
import type { PayStubLink } from '../../lib/payStubsApi'
const mocks = vi.hoisted(() => ({ period: vi.fn(), workers: vi.fn(), statements: vi.fn(), send: vi.fn(), download: vi.fn(), role: 'admin' }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ userRole: mocks.role, isClerkEnabled: true }) }))
vi.mock('../../lib/payStubsApi', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/payStubsApi')>(), payStubsApi: mocks }))
const worker = { id: 7, name: 'Mindy Cruz', first_name: 'Mindy', role: 'employee', on_file_email: 'm•••@example.test' }
const statement = { id: '42', pay_date: '2026-11-10', period_start: '2026-10-16', period_end: '2026-10-31', voided: false }
const link = { id: 1, state: 'active', worker: { id: 7, name: worker.name }, sent_at: '2026-11-15T01:00:00Z', recipient_email: worker.on_file_email, expires_at: '2026-11-22T01:00:00Z', max_downloads_per_document: 5 } as PayStubLink
const props = { start: '2026-10-16', end: '2026-10-31', paid: true, payDate: '2026-11-10', today: '2026-11-15' }
const open = (extra = {}) => render(<MemoryRouter><PayStubsStep {...props} {...extra} /></MemoryRouter>)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.role = 'admin'
  mocks.period.mockResolvedValue({ workers: [{ worker, statements: [statement], links: [] }, { worker: { ...worker, id: 8, name: 'No Email', on_file_email: null }, statements: [statement], links: [] }] })
  mocks.workers.mockResolvedValue({ workers: [worker], can_choose_recipient: false })
  mocks.statements.mockResolvedValue({ statements: [statement, { ...statement, id: '99', period_start: '2026-11-01', period_end: '2026-11-15', pay_date: '2026-11-25' }] })
  mocks.send.mockResolvedValue({ link, email_status: 'captured' })
})
it('waits for payday but allows a Paid period early', async () => {
  const view = open({ paid: false, payDate: '2026-11-20' })
  expect(screen.getByText(/Available after payday/)).toBeInTheDocument()
  expect(mocks.period).not.toHaveBeenCalled()
  view.rerender(<MemoryRouter><PayStubsStep {...props} payDate="2026-11-20" /></MemoryRouter>)
  expect(await screen.findByRole('button', { name: /Send pay stub to Mindy/ })).toBeInTheDocument()
})
it('lists missing email with a person link and no send button', async () => {
  open()
  const person = await screen.findByRole('link', { name: 'No Email' })
  expect(person).toHaveAttribute('href', '/admin/users/8')
  const row = within(person.closest('li')!)
  expect(row.getByRole('link', { name: 'add one on their page' })).toHaveAttribute('href', '/admin/users/8')
  expect(row.queryByRole('button', { name: /Send pay stub/ })).not.toBeInTheDocument()
})
it('sends only this person and period and updates history, without pay amounts', async () => {
  open()
  fireEvent.click(await screen.findByRole('button', { name: /Send pay stub to Mindy/ }))
  const dialog = within(await screen.findByRole('dialog'))
  await waitFor(() => expect(dialog.getByRole('button', { name: 'Send secure link' })).toBeEnabled())
  expect(dialog.queryByRole('combobox')).not.toBeInTheDocument()
  expect(dialog.getAllByRole('checkbox')).toHaveLength(1)

  fireEvent.click(dialog.getByRole('button', { name: 'Send secure link' }))
  expect(await dialog.findByText(/nothing was delivered/)).toBeInTheDocument()
  expect(mocks.send).toHaveBeenCalledWith({ userId: 7, statementIds: ['42'], requestId: null })
  fireEvent.click(dialog.getByRole('button', { name: 'Done' }))
  expect(screen.getByText(/Link sent/)).toHaveTextContent('Active')
  expect(document.body.textContent).not.toMatch(/\$|gross|net pay|hourly rate/i)
})
it('shows cancellation and rate-limit errors without marking a send successful', async () => {
  const { PayStubError } = await import('../../lib/payStubsApi')
  mocks.send.mockRejectedValueOnce(new PayStubError("The email couldn't be sent, so the link was cancelled. Please try again.", 'email_failed'))
    .mockRejectedValueOnce(new PayStubError('Too many tries. Please wait a few minutes and try again.', 'rate_limited', 429))
  open()
  fireEvent.click(await screen.findByRole('button', { name: /Send pay stub to Mindy/ }))
  const dialog = within(await screen.findByRole('dialog'))
  const send = dialog.getByRole('button', { name: 'Send secure link' })
  await waitFor(() => expect(send).toBeEnabled())
  fireEvent.click(send)
  expect(await dialog.findByRole('alert')).toHaveTextContent('the link was cancelled')
  fireEvent.click(send)
  await waitFor(() => expect(dialog.getByRole('alert')).toHaveTextContent('Too many tries'))
  expect(screen.queryByText(/Link sent/)).not.toBeInTheDocument()
})
it('retries a list failure and displays historical sends and failed attempts', async () => {
  mocks.period.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ workers: [{ worker, statements: [statement], links: [{ ...link, id: 2, state: 'failed' }, link] }] })
  open()
  expect(await screen.findByRole('alert')).toHaveTextContent("Pay stubs couldn't be loaded")
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText(/The email failed/)).toBeInTheDocument()
  expect(screen.queryByText(/Link sent/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Send again to Mindy/ })).toBeInTheDocument()
})

it('lets admins send and download for former staff with an address-check note', async () => {
  mocks.period.mockResolvedValue({ workers: [{ worker, inactive: true, statements: [statement], links: [], open_requests: [] }] })
  open()
  expect(await screen.findByText('No longer works here')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Download PDF for Mindy/ })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Send pay stub to Mindy/ }))
  const dialog = within(await screen.findByRole('dialog'))
  expect(dialog.getByText('Mindy Cruz no longer works here. Check the address before sending.')).toBeInTheDocument()
  fireEvent.click(dialog.getByRole('radio', { name: 'Another email' }))
  fireEvent.change(dialog.getByLabelText('Email'), { target: { value: 'home@example.test' } })
  fireEvent.change(dialog.getByLabelText('Type it again'), { target: { value: 'home@example.test' } })
  await waitFor(() => expect(dialog.getByRole('button', { name: 'Send secure link' })).toBeEnabled())
  fireEvent.click(dialog.getByRole('button', { name: 'Send secure link' }))
  await waitFor(() => expect(mocks.send).toHaveBeenCalledWith({ userId: 7, statementIds: ['42'], requestId: null, email: 'home@example.test', emailConfirmation: 'home@example.test' }))
})
it('keeps former-staff send and all PDF controls out of manager rows', async () => {
  mocks.role = 'manager'
  mocks.period.mockResolvedValue({ workers: [{ worker, inactive: true, statements: [statement], links: [], open_requests: [] }] })
  open()
  expect(await screen.findByText("No longer works here — stubs can't be emailed from here")).toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})
it.each([
  { scope: 'latest', statement_id: '42', recipient_kind: 'on_file', expected: 20 },
  { scope: 'pay_date', statement_id: '42', recipient_kind: 'on_file', expected: 20 },
  { scope: 'latest', statement_id: '99', recipient_kind: 'on_file', expected: null },
  { scope: 'pay_date', statement_id: '99', recipient_kind: 'on_file', expected: null },
  { scope: 'latest', statement_id: null, recipient_kind: 'typed', expected: null },
])('passes only a matching on-file request: %o', async ({ expected, ...request }) => {
  mocks.period.mockResolvedValue({ workers: [{ worker, statements: [statement], links: [], open_requests: [{ id: 20, ...request }] }] })
  open()
  expect(await screen.findByText(/Asked for their stub/)).toBeInTheDocument()
  if (request.recipient_kind === 'typed') expect(screen.getByText(/asked for a different email; handle that request/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Send pay stub to Mindy/ }))
  const dialog = within(await screen.findByRole('dialog'))
  const send = dialog.getByRole('button', { name: 'Send secure link' })
  await waitFor(() => expect(send).toBeEnabled())
  fireEvent.click(send)
  await waitFor(() => expect(mocks.send).toHaveBeenCalledWith({ userId: 7, statementIds: ['42'], requestId: expected }))
})
it('shows a retry for a failed lookup and an honest stale pending status', async () => {
  mocks.period.mockResolvedValue({ workers: [{ worker, lookup_failed: true, statements: [], links: [] }, { worker: { ...worker, id: 8 }, statements: [statement], links: [{ ...link, state: 'pending', sent_at: '2020-01-01T00:00:00Z' }] }] })
  open()
  expect(await screen.findByText(/Couldn't check this person's stubs/)).toBeInTheDocument()
  expect(screen.getByText("Didn't finish — you can send again")).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Sent links and requests' })).toHaveAttribute('href', '/admin/pay-stubs')
})

it('explains that sending again keeps the earlier link active', async () => {
  mocks.period.mockResolvedValue({ workers: [{ worker, statements: [statement], links: [link] }] })
  open()
  fireEvent.click(await screen.findByRole('button', { name: /Send again to Mindy/ }))
  expect(within(await screen.findByRole('dialog')).getByText('The earlier link still works until it expires.')).toBeInTheDocument()
})
