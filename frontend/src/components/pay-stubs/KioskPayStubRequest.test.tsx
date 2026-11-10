import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import KioskPayStubRequest from './KioskPayStubRequest'

const api = vi.hoisted(() => ({ choices: vi.fn(), request: vi.fn() }))
vi.mock('../../lib/payStubsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/payStubsApi')>()
  return { ...actual, kioskPayStubsApi: api }
})

const choices = {
  pay_dates: [{ statement_id: '42', pay_date: '2026-11-15' }, { statement_id: '41', pay_date: '2026-10-31' }],
  years: [2026, 2025],
  pay_dates_available: true,
  on_file_email_hint: 'm•••@example.com',
}

function renderPanel() {
  const props = { onActivity: vi.fn(), onCancel: vi.fn(), onSent: vi.fn() }
  render(<KioskPayStubRequest kioskAccessToken="access" kioskToken="employee" {...props} />)
  return props
}

beforeEach(() => {
  vi.clearAllMocks()
  api.choices.mockResolvedValue(choices)
  api.request.mockResolvedValue({ message: 'Your request was sent to the office.' })
})

it('sends a one-tap request for the latest stub to the email on file', async () => {
  const props = renderPanel()
  expect(await screen.findByText('m•••@example.com')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Send request to the office' }))
  await waitFor(() => expect(props.onSent).toHaveBeenCalledWith('Your request was sent to the office.'))
  expect(api.request).toHaveBeenCalledWith('access', 'employee', { scope: 'latest', statementId: undefined, year: undefined })
})

it('asks for a pay date and keeps the idle timer awake', async () => {
  const props = renderPanel()
  fireEvent.click(await screen.findByRole('button', { name: /A specific pay date/ }))
  const send = screen.getByRole('button', { name: 'Send request to the office' })
  expect(send).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Oct 31, 2026' }))
  fireEvent.click(send)
  await waitFor(() => expect(api.request).toHaveBeenCalledWith('access', 'employee', { scope: 'pay_date', statementId: '41', year: undefined }))
  expect(props.onActivity).toHaveBeenCalled()
})

it('sends a year to an email typed twice', async () => {
  renderPanel()
  fireEvent.click(await screen.findByRole('button', { name: /A whole year/ }))
  fireEvent.click(screen.getByRole('button', { name: '2025' }))
  fireEvent.click(screen.getByRole('button', { name: 'A different email' }))
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'mindy@home.test' } })
  fireEvent.change(screen.getByLabelText('Type it again'), { target: { value: 'mindy@home.tes' } })
  expect(screen.getByText("The two emails don't match yet.")).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Send request to the office' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Type it again'), { target: { value: 'mindy@home.test' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send request to the office' }))
  await waitFor(() => expect(api.request).toHaveBeenCalledWith('access', 'employee', { scope: 'year', statementId: undefined, year: 2025, email: 'mindy@home.test', emailConfirmation: 'mindy@home.test' }))
})

it('needs a typed email when none is on file, and offers no dates when payroll is down', async () => {
  api.choices.mockResolvedValue({ ...choices, pay_dates: [], pay_dates_available: false, on_file_email_hint: null })
  renderPanel()
  expect(await screen.findByText(/no email on file for you/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /A specific pay date/ })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Send request to the office' })).toBeDisabled()
})

it('shows why a request was refused', async () => {
  api.request.mockRejectedValue(new (await import('../../lib/payStubsApi')).PayStubError("You've already asked for pay stubs 3 times today.", 'rate_limited', 429))
  renderPanel()
  fireEvent.click(await screen.findByRole('button', { name: 'Send request to the office' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('3 times today')
})
